using System.Diagnostics;
using SignalRC.Onboard.Control;
using SignalRC.Shared.Channels;
using SignalRC.Shared.HubClients;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard;

/// <summary>
/// Two-way audio for the vehicle, driven entirely through ffmpeg + ALSA:
/// <list type="bullet">
/// <item>Uplink (vehicle → browser): the microphone configured on a video stream
/// (<see cref="VideoStreamMapItem.AudioDevice"/>) is captured, encoded to Opus and sent as RTP to the
/// audio port of that stream's Janus mountpoint. It runs while the stream runs, in its own ffmpeg so a
/// broken microphone can't take the video down. Outbound UDP like the video, so it works behind CGNAT.</item>
/// <item>Downlink (browser → vehicle): push-to-talk chunks (WebM/Ogg with Opus) arrive over the
/// SignalR connection and are piped into ffmpeg's stdin, which plays them on ALSA. Only the active
/// control session may talk; playback stops when the session changes.</item>
/// </list>
/// </summary>
public class AudioService : IAudioClient
{
    private static readonly TimeSpan UplinkRestartDelay = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan PlaybackIdleTimeout = TimeSpan.FromSeconds(5);
    private const int MaxChunkBytes = 64 * 1024;
    private const int UplinkBitrate = 32000;
    // Cuts rumble/wind below 100 Hz, then FFT denoising against steady background noise (engine, motor whine).
    private const string DenoiseFilter = "highpass=f=100,afftdn=nf=-25";

    private readonly ILogger<AudioService> _logger;
    private readonly IConfiguration _configuration;
    private readonly ControlService _controlService;
    private readonly ChannelMap _channelMap;
    private readonly object _lock = new();

    private readonly Dictionary<string, Uplink> _uplinks = new();

    private Process? _playbackProcess;
    private Stream? _playbackInput;
    private DateTime _lastChunkAt;
    private Timer? _playbackWatchdog;
    // Chunks must reach ffmpeg in order; SignalR dispatches them sequentially per connection,
    // the semaphore only guards against a concurrent Stop while a write is in flight.
    private readonly SemaphoreSlim _playbackWriteLock = new(1, 1);

    public AudioService(ILogger<AudioService> logger, IConfiguration configuration, ControlService controlService, ChannelMap channelMap)
    {
        _logger = logger;
        _configuration = configuration;
        _controlService = controlService;
        _channelMap = channelMap;
        _controlService.SessionChanged += () =>
        {
            _logger.LogInformation("Control session changed, stopping push-to-talk playback.");
            _ = StopPlaybackInternalAsync();
        };
    }

    private bool AudioEnabled => _configuration.GetValue<bool?>("audio") ?? true;

    // -- Uplink: video stream microphone → Janus ---------------------------------------

    public Task StartAudioUplink(string streamId, int port)
    {
        if (!AudioEnabled)
        {
            _logger.LogInformation("Audio uplink for stream {StreamId} skipped: audio is disabled (feature flag 'audio').", streamId);
            return Task.CompletedTask;
        }
        if (!_channelMap.VideoStreams.TryGetValue(streamId, out var stream) || string.IsNullOrWhiteSpace(stream.AudioDevice))
        {
            _logger.LogWarning("Audio uplink requested for stream {StreamId}, but it has no audio device configured.", streamId);
            return Task.CompletedTask;
        }

        var host = _configuration.GetValue<string>("ServerName");
        if (string.IsNullOrWhiteSpace(host)) host = "localhost";
        var filter = stream.AudioDenoise ? $"-af {DenoiseFilter} " : "";
        var args = $"-hide_banner -loglevel warning -nostdin -f alsa -i {stream.AudioDevice} {filter}-ac 1 -ar 48000 " +
                   $"-c:a libopus -b:a {UplinkBitrate} -application voip -frame_duration 20 " +
                   $"-f rtp -payload_type 111 rtp://{host}:{port}?pkt_size=1200";

        lock (_lock)
        {
            if (_uplinks.TryGetValue(streamId, out var running) && running.Args == args)
            {
                _logger.LogDebug("Audio uplink for stream {StreamId} already running.", streamId);
                return Task.CompletedTask;
            }
        }
        StopUplink(streamId);

        var uplink = new Uplink(args);
        lock (_lock) _uplinks[streamId] = uplink;
        _logger.LogInformation("Starting audio uplink for stream {StreamId}: ffmpeg {Args}", streamId, args);
        _ = Task.Run(() => RunUplinkLoopAsync(streamId, uplink));
        return Task.CompletedTask;
    }

    public Task StopAudioUplink(string streamId)
    {
        StopUplink(streamId);
        return Task.CompletedTask;
    }

    private async Task RunUplinkLoopAsync(string streamId, Uplink uplink)
    {
        var token = uplink.Cts.Token;
        while (!token.IsCancellationRequested)
        {
            Process process;
            try
            {
                process = StartFfmpeg(uplink.Args, redirectInput: false, $"uplink {streamId}");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to start audio uplink ffmpeg for stream {StreamId}.", streamId);
                return;
            }
            uplink.Process = process;

            try
            {
                await process.WaitForExitAsync(token);
                _logger.LogWarning("Audio uplink ffmpeg for stream {StreamId} exited with code {ExitCode}; restarting in {Delay}s.",
                    streamId, process.ExitCode, UplinkRestartDelay.TotalSeconds);
                await Task.Delay(UplinkRestartDelay, token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private void StopUplink(string streamId)
    {
        Uplink? uplink;
        lock (_lock)
        {
            if (!_uplinks.Remove(streamId, out uplink)) return;
        }
        uplink.Cts.Cancel();
        KillProcess(uplink.Process, $"uplink {streamId}");
        _logger.LogInformation("Audio uplink for stream {StreamId} stopped.", streamId);
    }

    private sealed class Uplink(string args)
    {
        public string Args { get; } = args;
        public CancellationTokenSource Cts { get; } = new();
        public Process? Process { get; set; }
    }

    // -- Downlink: browser push-to-talk → vehicle speaker ------------------------------

    public async Task<bool> StartAudioPlayback(string sessionId, string format, string outputDevice)
    {
        if (!AudioEnabled)
        {
            _logger.LogWarning("Push-to-talk rejected: audio is disabled (feature flag 'audio').");
            return false;
        }
        if (!_controlService.IsActiveSession(sessionId))
        {
            _logger.LogWarning("Push-to-talk rejected: session {SessionId} is not the active control session.", sessionId);
            return false;
        }
        if (string.IsNullOrWhiteSpace(outputDevice))
        {
            _logger.LogWarning("Push-to-talk rejected: no speaker configured for this vehicle.");
            return false;
        }

        var demuxer = format switch
        {
            "webm" => "matroska",
            "ogg" => "ogg",
            _ => null
        };
        if (demuxer == null)
        {
            _logger.LogWarning("Unsupported push-to-talk format '{Format}'.", format);
            return false;
        }

        await StopPlaybackInternalAsync();

        var args = $"-hide_banner -loglevel warning -fflags nobuffer -flags low_delay " +
                   $"-probesize 4096 -analyzeduration 0 -f {demuxer} -i pipe:0 -f alsa {outputDevice}";
        _logger.LogInformation("Starting audio playback: ffmpeg {Args}", args);
        try
        {
            var process = StartFfmpeg(args, redirectInput: true, "playback");
            lock (_lock)
            {
                _playbackProcess = process;
                _playbackInput = process.StandardInput.BaseStream;
                _lastChunkAt = DateTime.UtcNow;
                _playbackWatchdog = new Timer(_ => OnPlaybackWatchdog(), null, PlaybackIdleTimeout, PlaybackIdleTimeout);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start audio playback ffmpeg.");
            return false;
        }
        _controlService.MarkSessionActivity();
        return true;
    }

    public async Task PlayAudioChunk(string sessionId, byte[] chunk)
    {
        if (chunk.Length == 0 || chunk.Length > MaxChunkBytes)
            return;
        if (!_controlService.IsActiveSession(sessionId))
            return;

        Stream? input;
        lock (_lock)
        {
            input = _playbackInput;
            _lastChunkAt = DateTime.UtcNow;
        }
        if (input == null)
            return;

        await _playbackWriteLock.WaitAsync();
        try
        {
            await input.WriteAsync(chunk);
            await input.FlushAsync();
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException)
        {
            _logger.LogWarning("Audio playback pipe closed: {Message}", ex.Message);
        }
        finally
        {
            _playbackWriteLock.Release();
        }
        _controlService.MarkSessionActivity();
    }

    public async Task StopAudioPlayback(string sessionId)
    {
        if (!_controlService.IsActiveSession(sessionId))
            return;
        await StopPlaybackInternalAsync();
    }

    private void OnPlaybackWatchdog()
    {
        DateTime last;
        lock (_lock) last = _lastChunkAt;
        if (DateTime.UtcNow - last > PlaybackIdleTimeout)
        {
            _logger.LogWarning("No push-to-talk data for {Timeout}s, stopping playback.", PlaybackIdleTimeout.TotalSeconds);
            _ = StopPlaybackInternalAsync();
        }
    }

    private async Task StopPlaybackInternalAsync()
    {
        Process? process;
        Stream? input;
        Timer? watchdog;
        lock (_lock)
        {
            process = _playbackProcess;
            input = _playbackInput;
            watchdog = _playbackWatchdog;
            _playbackProcess = null;
            _playbackInput = null;
            _playbackWatchdog = null;
        }
        if (process == null) return;
        watchdog?.Dispose();

        await _playbackWriteLock.WaitAsync();
        try
        {
            // Closing stdin lets ffmpeg drain what it already buffered before it exits.
            input?.Close();
        }
        catch { /* pipe already gone */ }
        finally
        {
            _playbackWriteLock.Release();
        }

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await process.WaitForExitAsync(cts.Token);
            process.Dispose();
        }
        catch (OperationCanceledException)
        {
            KillProcess(process, "playback");
        }
        _logger.LogInformation("Audio playback stopped.");
    }

    // -- helpers ----------------------------------------------------------------------

    private Process StartFfmpeg(string args, bool redirectInput, string role)
    {
        var process = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg", args)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = redirectInput,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
            }
        };
        process.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
                _logger.LogWarning("ffmpeg audio {Role}: {Line}", role, e.Data);
        };
        process.OutputDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
                _logger.LogDebug("ffmpeg audio {Role}: {Line}", role, e.Data);
        };
        process.Start();
        process.BeginErrorReadLine();
        process.BeginOutputReadLine();
        return process;
    }

    private void KillProcess(Process? process, string role)
    {
        if (process == null) return;
        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
            process.Dispose();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to stop audio {Role} ffmpeg.", role);
        }
    }
}

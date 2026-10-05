using System.Diagnostics;
using SignalRC.Onboard.Control;
using SignalRC.Shared.HubClients;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard;

/// <summary>
/// Two-way audio for the vehicle, driven entirely through ffmpeg + ALSA:
/// <list type="bullet">
/// <item>Uplink (vehicle → browser): ALSA capture → Opus → RTP to the Janus port the server allocated.
/// Outbound UDP like the video stream, so it works behind LTE CGNAT.</item>
/// <item>Downlink (browser → vehicle): push-to-talk chunks (WebM/Ogg with Opus) arrive over the
/// SignalR connection and are piped into ffmpeg's stdin, which plays them on ALSA.</item>
/// </list>
/// Both directions are bound to the active control session and torn down when it changes.
/// </summary>
public class AudioService : IAudioClient
{
    private static readonly TimeSpan UplinkRestartDelay = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan PlaybackIdleTimeout = TimeSpan.FromSeconds(5);
    private const int MaxChunkBytes = 64 * 1024;

    private readonly ILogger<AudioService> _logger;
    private readonly IConfiguration _configuration;
    private readonly ControlService _controlService;
    private readonly object _lock = new();

    private Process? _uplinkProcess;
    private CancellationTokenSource? _uplinkCts;
    private int? _uplinkPort;

    private Process? _playbackProcess;
    private Stream? _playbackInput;
    private DateTime _lastChunkAt;
    private Timer? _playbackWatchdog;
    // Chunks must reach ffmpeg in order; SignalR dispatches them sequentially per connection,
    // the semaphore only guards against a concurrent Stop while a write is in flight.
    private readonly SemaphoreSlim _playbackWriteLock = new(1, 1);

    public AudioService(ILogger<AudioService> logger, IConfiguration configuration, ControlService controlService)
    {
        _logger = logger;
        _configuration = configuration;
        _controlService = controlService;
        _controlService.SessionChanged += () =>
        {
            _logger.LogInformation("Control session changed, stopping audio.");
            StopUplink();
            _ = StopPlaybackInternalAsync();
        };
    }

    private bool AudioEnabled => _configuration.GetValue<bool?>("audio") ?? true;
    private string InputDevice => _configuration.GetValue<string>("Audio:InputDevice") ?? "default";
    private string OutputDevice => _configuration.GetValue<string>("Audio:OutputDevice") ?? "default";
    private int UplinkBitrate => _configuration.GetValue<int?>("Audio:UplinkBitrate") ?? 32000;

    private bool CheckSession(string sessionId, string action)
    {
        if (!AudioEnabled)
        {
            _logger.LogWarning("{Action} rejected: audio is disabled (feature flag 'audio').", action);
            return false;
        }
        if (!_controlService.IsActiveSession(sessionId))
        {
            _logger.LogWarning("{Action} rejected: session {SessionId} is not the active control session.", action, sessionId);
            return false;
        }
        return true;
    }

    // -- Uplink: vehicle microphone → Janus ------------------------------------------

    public Task<bool> StartAudioUplink(string sessionId, int port)
    {
        if (!CheckSession(sessionId, nameof(StartAudioUplink)))
            return Task.FromResult(false);

        lock (_lock)
        {
            if (_uplinkCts != null && _uplinkPort == port)
            {
                _logger.LogDebug("Audio uplink already running to port {Port}.", port);
                return Task.FromResult(true);
            }
        }

        StopUplink();
        var host = _configuration.GetValue<string>("ServerName");
        if (string.IsNullOrWhiteSpace(host)) host = "localhost";

        var cts = new CancellationTokenSource();
        lock (_lock)
        {
            _uplinkCts = cts;
            _uplinkPort = port;
        }
        var args = $"-hide_banner -loglevel warning -nostdin -f alsa -i {InputDevice} -ac 1 -ar 48000 " +
                   $"-c:a libopus -b:a {UplinkBitrate} -application voip -frame_duration 20 " +
                   $"-f rtp -payload_type 111 rtp://{host}:{port}?pkt_size=1200";
        _logger.LogInformation("Starting audio uplink: ffmpeg {Args}", args);
        _ = Task.Run(() => RunUplinkLoopAsync(args, cts.Token));
        return Task.FromResult(true);
    }

    public Task StopAudioUplink()
    {
        StopUplink();
        return Task.CompletedTask;
    }

    private async Task RunUplinkLoopAsync(string args, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            Process process;
            try
            {
                process = StartFfmpeg(args, redirectInput: false, "uplink");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to start audio uplink ffmpeg.");
                return;
            }
            lock (_lock) _uplinkProcess = process;

            try
            {
                await process.WaitForExitAsync(token);
                _logger.LogWarning("Audio uplink ffmpeg exited with code {ExitCode}; restarting in {Delay}s.",
                    process.ExitCode, UplinkRestartDelay.TotalSeconds);
                await Task.Delay(UplinkRestartDelay, token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private void StopUplink()
    {
        Process? process;
        CancellationTokenSource? cts;
        lock (_lock)
        {
            process = _uplinkProcess;
            cts = _uplinkCts;
            _uplinkProcess = null;
            _uplinkCts = null;
            _uplinkPort = null;
        }
        if (cts == null) return;
        cts.Cancel();
        KillProcess(process, "uplink");
        _logger.LogInformation("Audio uplink stopped.");
    }

    // -- Downlink: browser push-to-talk → vehicle speaker ------------------------------

    public async Task<bool> StartAudioPlayback(string sessionId, string format)
    {
        if (!CheckSession(sessionId, nameof(StartAudioPlayback)))
            return false;

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
                   $"-probesize 4096 -analyzeduration 0 -f {demuxer} -i pipe:0 -f alsa {OutputDevice}";
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

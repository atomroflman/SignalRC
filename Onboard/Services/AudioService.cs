using System.Diagnostics;
using SignalRC.Onboard.Control;
using SignalRC.Shared.Audio;
using SignalRC.Shared.HubClients;
using SignalRC.Shared.Video;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard;

/// <summary>
/// Two-way audio for the vehicle, driven entirely through ffmpeg + ALSA:
/// <list type="bullet">
/// <item>Uplink (vehicle → browser): the car's microphone (<see cref="AudioSettings.InputDevice"/>) is
/// captured, encoded to Opus and sent as RTP to the car's audio-only Janus mountpoint while at least one
/// browser listens. Outbound UDP like the video, so it works behind CGNAT.</item>
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
    // Cuts rumble/wind below 100 Hz, then FFT denoising against steady background noise (engine, motor whine).
    private const string DenoiseFilter = "highpass=f=100,afftdn=nf=-25";

    private readonly ILogger<AudioService> _logger;
    private readonly IConfiguration _configuration;
    private readonly ControlService _controlService;
    private readonly object _lock = new();

    // Pushed by the server on every (re)connect and change; no devices until then.
    private AudioSettings _settings = new();
    // Set while the server wants the microphone sent (someone listens).
    private int? _uplinkPort;
    private Uplink? _uplink;

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
            _logger.LogInformation("Control session changed, stopping push-to-talk playback.");
            _ = StopPlaybackInternalAsync();
        };
    }

    private bool AudioEnabled => _configuration.GetValue<bool?>("audio") ?? true;

    public Task ApplyAudioSettings(AudioSettings settings)
    {
        lock (_lock) _settings = settings.Normalized();
        _logger.LogInformation("Audio settings: input '{Input}' ({Channel}, gain {Gain}, denoise {Denoise}, {Bitrate} kbit/s), output '{Output}' (volume {Volume}).",
            _settings.InputDevice, _settings.InputChannel, _settings.InputGain, _settings.Denoise, _settings.BitrateKbps, _settings.OutputDevice, _settings.OutputVolume);
        ReconcileUplink();
        return Task.CompletedTask;
    }

    // -- Uplink: car microphone → Janus ----------------------------------------------

    public Task StartAudioUplink(int port)
    {
        lock (_lock) _uplinkPort = port;
        ReconcileUplink();
        return Task.CompletedTask;
    }

    public Task StopAudioUplink()
    {
        lock (_lock) _uplinkPort = null;
        StopUplink();
        return Task.CompletedTask;
    }

    /// <summary>
    /// Runs the uplink when the server wants it and a microphone is configured; restarts it when the
    /// settings that go into the ffmpeg command changed.
    /// </summary>
    private void ReconcileUplink()
    {
        AudioSettings settings;
        int? port;
        lock (_lock) (settings, port) = (_settings, _uplinkPort);

        if (port == null || string.IsNullOrWhiteSpace(settings.InputDevice))
        {
            StopUplink();
            return;
        }
        if (!AudioEnabled)
        {
            _logger.LogInformation("Audio uplink skipped: audio is disabled (feature flag 'audio').");
            return;
        }

        var host = _configuration.GetValue<string>("ServerName");
        if (string.IsNullOrWhiteSpace(host)) host = "localhost";
        var args = $"-hide_banner -loglevel warning -nostdin {CaptureInputArgs(settings)} -af {CaptureFilter(settings)} -ac 1 -ar 48000 " +
                   $"-c:a libopus -b:a {settings.BitrateKbps}k -application voip -frame_duration 20 " +
                   $"-f rtp -payload_type 111 rtp://{host}:{port}?pkt_size=1200";

        lock (_lock)
        {
            if (_uplink != null && _uplink.Args == args)
                return;
        }
        StopUplink();

        var uplink = new Uplink(args);
        lock (_lock) _uplink = uplink;
        _logger.LogInformation("Starting audio uplink: ffmpeg {Args}", args);
        _ = Task.Run(() => RunUplinkLoopAsync(uplink));
    }

    private static string CaptureInputArgs(AudioSettings settings) =>
        // Picking one side needs both channels; plughw converts if the card only has one.
        (settings.InputChannel is AudioSettings.ChannelLeft or AudioSettings.ChannelRight ? "-channels 2 " : "") +
        $"-f alsa -i {settings.InputDevice}";

    private static string CaptureFilter(AudioSettings settings)
    {
        var filters = new List<string>();
        if (settings.InputChannel == AudioSettings.ChannelLeft) filters.Add("pan=mono|c0=c0");
        else if (settings.InputChannel == AudioSettings.ChannelRight) filters.Add("pan=mono|c0=c1");
        if (settings.Denoise) filters.Add(DenoiseFilter);
        filters.Add(FormattableString.Invariant($"volume={settings.InputGain:0.###}"));
        return string.Join(',', filters);
    }

    private async Task RunUplinkLoopAsync(Uplink uplink)
    {
        var token = uplink.Cts.Token;
        while (!token.IsCancellationRequested)
        {
            Process process;
            try
            {
                process = StartFfmpeg(uplink.Args, redirectInput: false, "uplink");
            }
            catch (Exception ex)
            {
                // Forget the uplink, otherwise the next StartAudioUplink with the same args is
                // taken for "already running" and the microphone stays off until a restart.
                _logger.LogError(ex, "Failed to start audio uplink ffmpeg; the next listener retries.");
                lock (_lock)
                {
                    if (_uplink == uplink)
                        _uplink = null;
                }
                return;
            }
            uplink.Process = process;

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
        Uplink? uplink;
        lock (_lock)
        {
            uplink = _uplink;
            _uplink = null;
        }
        if (uplink == null) return;
        uplink.Cts.Cancel();
        KillProcess(uplink.Process, "uplink");
        _logger.LogInformation("Audio uplink stopped.");
    }

    private sealed class Uplink(string args)
    {
        public string Args { get; } = args;
        public CancellationTokenSource Cts { get; } = new();
        public Process? Process { get; set; }
    }

    // -- Downlink: browser push-to-talk → vehicle speaker ------------------------------

    public async Task<bool> StartAudioPlayback(string sessionId, string format)
    {
        AudioSettings settings;
        lock (_lock) settings = _settings;
        var outputDevice = settings.OutputDevice;
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
                   $"-probesize 4096 -analyzeduration 0 -f {demuxer} -i pipe:0 " +
                   FormattableString.Invariant($"-af volume={settings.OutputVolume:0.###} -f alsa {outputDevice}");
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

    // -- Diagnostics ------------------------------------------------------------------

    public async Task<DiagnosticCheck[]> GetAudioDiagnostics()
    {
        AudioSettings settings;
        lock (_lock) settings = _settings;
        var outputDevice = settings.OutputDevice;
        var checks = new List<DiagnosticCheck>();
        void Add(string step, string title, DiagnosticStatus status, string message) =>
            checks.Add(new DiagnosticCheck { Step = step, Title = title, Status = status, Message = message });

        if (!AudioEnabled)
        {
            Add("A0", "Audio", DiagnosticStatus.Info, "Feature-Flag 'audio' ist aus – Audio wird abgelehnt.");
            return checks.ToArray();
        }

        var encoders = await RunToolAsync("ffmpeg", "-hide_banner -encoders");
        if (encoders.ExitCode != 0)
            Add("A1", "ffmpeg", DiagnosticStatus.Error, "ffmpeg nicht gefunden oder nicht ausführbar.");
        else if (!encoders.Output.Contains(" libopus "))
            Add("A1", "ffmpeg Opus", DiagnosticStatus.Error, "ffmpeg ist ohne libopus gebaut – Audio kann nicht kodiert werden.");
        else
            Add("A1", "ffmpeg Opus", DiagnosticStatus.Ok, "libopus-Encoder vorhanden.");

        var devices = await RunToolAsync("ffmpeg", "-hide_banner -devices");
        if (devices.ExitCode == 0)
        {
            Add("A2", "ffmpeg ALSA", devices.Output.Contains(" alsa ") ? DiagnosticStatus.Ok : DiagnosticStatus.Error,
                devices.Output.Contains(" alsa ") ? "ALSA-Ein-/Ausgabe vorhanden." : "ffmpeg ist ohne ALSA-Unterstützung gebaut.");
        }

        var arecord = await RunToolAsync("arecord", "--version");
        Add("A3", "alsa-utils", arecord.ExitCode == 0 ? DiagnosticStatus.Ok : DiagnosticStatus.Warning,
            arecord.ExitCode == 0 ? "arecord/aplay vorhanden." : "alsa-utils fehlen – Geräteliste in der UI bleibt leer (apt install alsa-utils).");

        var groups = await RunToolAsync("id", "-nG");
        if (groups.ExitCode == 0)
        {
            var inAudioGroup = groups.Output.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Contains("audio");
            Add("A4", "Gruppe 'audio'", inAudioGroup ? DiagnosticStatus.Ok : DiagnosticStatus.Warning,
                inAudioGroup ? "Service-User ist in der Gruppe 'audio'."
                             : $"Service-User ({Environment.UserName}) ist nicht in der Gruppe 'audio' – ALSA-Geräte sind evtl. nicht zugreifbar (sudo usermod -aG audio {Environment.UserName}, danach Dienst neu starten).");
        }

        var step = 5;
        if (string.IsNullOrWhiteSpace(settings.InputDevice))
        {
            Add($"A{step++}", "Mikrofon", DiagnosticStatus.Info, "Kein Mikrofon konfiguriert – Mithören ist ausgeblendet.");
        }
        else
        {
            bool running;
            lock (_lock) running = _uplink != null;
            var title = $"Mikrofon ({settings.InputDevice})";
            if (running)
            {
                Add($"A{step++}", title, DiagnosticStatus.Ok, "Uplink läuft gerade (Gerät ist belegt, kein Test nötig).");
            }
            else
            {
                var test = await RunToolAsync("arecord", $"-q -D {settings.InputDevice} -f S16_LE -r 48000 -c 1 -d 1 /dev/null", TimeSpan.FromSeconds(5));
                Add($"A{step++}", title, test.ExitCode == 0 ? DiagnosticStatus.Ok : DiagnosticStatus.Error,
                    test.ExitCode == 0 ? "1 s Aufnahme erfolgreich." : $"Aufnahme fehlgeschlagen: {DescribeAlsaError(test.Error)}");
            }
        }

        if (string.IsNullOrWhiteSpace(outputDevice))
        {
            Add($"A{step}", "Lautsprecher", DiagnosticStatus.Info, "Kein Lautsprecher konfiguriert – Push-to-Talk ist ausgeblendet.");
        }
        else
        {
            bool playing;
            lock (_lock) playing = _playbackProcess != null;
            var title = $"Lautsprecher ({outputDevice})";
            if (playing)
            {
                Add($"A{step}", title, DiagnosticStatus.Ok, "Push-to-Talk spielt gerade (Gerät ist belegt, kein Test nötig).");
            }
            else
            {
                // Plays one second of silence: proves the device opens without making noise.
                var test = await RunToolAsync("aplay", $"-q -D {outputDevice} -f S16_LE -r 48000 -c 2 -d 1 /dev/zero", TimeSpan.FromSeconds(5));
                Add($"A{step}", title, test.ExitCode == 0 ? DiagnosticStatus.Ok : DiagnosticStatus.Error,
                    test.ExitCode == 0 ? "Gerät lässt sich öffnen (1 s Stille abgespielt)." : $"Wiedergabe fehlgeschlagen: {DescribeAlsaError(test.Error)}");
            }
        }

        return checks.ToArray();
    }

    // arecord/aplay print ALSA lib noise first; the "audio open error: …" line at the end is the useful one.
    private static string DescribeAlsaError(string stderr)
    {
        var lines = stderr.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var line = lines.LastOrDefault(l => l.Contains("error", StringComparison.OrdinalIgnoreCase)) ?? lines.LastOrDefault();
        if (string.IsNullOrEmpty(line)) return "keine Fehlermeldung";
        if (line.Contains("busy", StringComparison.OrdinalIgnoreCase))
            line += " – das Gerät ist von einem anderen Prozess belegt (z. B. PipeWire/PulseAudio).";
        return line;
    }

    private static async Task<(int ExitCode, string Output, string Error)> RunToolAsync(string tool, string args, TimeSpan? timeout = null)
    {
        try
        {
            var startInfo = new ProcessStartInfo(tool, args)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            startInfo.Environment["LC_ALL"] = "C";
            using var process = Process.Start(startInfo);
            if (process == null) return (-1, string.Empty, $"{tool} konnte nicht gestartet werden");
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            using var cts = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(5));
            try
            {
                await process.WaitForExitAsync(cts.Token);
            }
            catch (OperationCanceledException)
            {
                process.Kill(entireProcessTree: true);
                return (-1, await stdout, "Zeitüberschreitung");
            }
            return (process.ExitCode, await stdout, await stderr);
        }
        catch (Exception ex)
        {
            return (-1, string.Empty, ex.Message);
        }
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

using System.Diagnostics;
using SignalRC.Onboard.Audio;
using SignalRC.Onboard.Control;
using SignalRC.Onboard.Services;
using SignalRC.Shared.Audio;
using SignalRC.Shared.HubClients;
using SignalRC.Shared.Video;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard;

/// <summary>
/// Two-way audio for the vehicle. Owns the parts of the audio engine and wires them to the server:
/// <list type="bullet">
/// <item><see cref="MicUplink"/>: the car's microphone (<see cref="AudioSettings.InputDevice"/>) → Opus/RTP
/// → the car's audio-only Janus mountpoint, while at least one browser listens. Outbound UDP like the
/// video, so it works behind CGNAT.</item>
/// <item><see cref="AudioMixer"/>: the speaker. Push-to-talk (<see cref="PushToTalkSource"/>) and sound
/// channels play mixed. Only the active control session may talk; talking stops when the session changes.</item>
/// <item>While push-to-talk plays (plus a short hangover for the speaker tail and room echo) the
/// microphone is muted, so listeners don't hear the driver a second time.</item>
/// <item>Levels and state go to the server as <see cref="AudioStatus"/> while anything runs.</item>
/// <item>The sound library for SoundPlayer channels is kept in sync (<see cref="SoundLibrary"/>).</item>
/// </list>
/// Configuration comes from the server (<see cref="ApplyAudioSettings"/>) on every connect and change.
/// </summary>
public class AudioService : IAudioClient
{
    private static readonly TimeSpan PlaybackIdleTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan TalkHangover = TimeSpan.FromMilliseconds(400);
    private static readonly TimeSpan TickInterval = TimeSpan.FromMilliseconds(250);
    private const int MaxChunkBytes = 64 * 1024;
    // Cuts rumble/wind below 100 Hz, then FFT denoising against steady background noise (engine, motor whine).
    private const string DenoiseFilter = "highpass=f=100,afftdn=nf=-25";

    private readonly ILogger<AudioService> _logger;
    private readonly IConfiguration _configuration;
    private readonly ControlService _controlService;
    private readonly ServerConnectionService _serverConnection;
    private readonly AudioMixer _mixer;
    private readonly SoundLibrary _library;
    private readonly object _lock = new();
    private readonly object _uplinkLock = new();
    private readonly Timer _timer;

    // Pushed by the server on every (re)connect and change; no devices until then.
    private AudioSettings _settings = new();
    // Set while the server wants the microphone sent (someone listens).
    private int? _uplinkPort;
    private MicUplink? _uplink;
    private PushToTalkSource? _talk;
    private DateTime _lastChunkAt;
    private DateTime _talkEndedAt = DateTime.MinValue;
    private bool _reportedActive;
    private int _ticking;
    private IConnectionHubServer? _server;

    public AudioService(
        ILogger<AudioService> logger,
        IConfiguration configuration,
        ControlService controlService,
        ServerConnectionService serverConnection,
        AudioMixer mixer,
        SoundLibrary library)
    {
        _logger = logger;
        _configuration = configuration;
        _controlService = controlService;
        _serverConnection = serverConnection;
        _mixer = mixer;
        _library = library;
        _mixer.SourceFinished += OnSourceFinished;
        _controlService.SessionChanged += () =>
        {
            _logger.LogInformation("Control session changed, stopping push-to-talk.");
            AbortTalk();
        };
        _timer = new Timer(_ => Tick(), null, TickInterval, TickInterval);
    }

    private bool AudioEnabled => _configuration.GetValue<bool?>("audio") ?? true;

    public AudioSettings Settings
    {
        get { lock (_lock) return _settings; }
    }

    public Task ApplyAudioSettings(AudioSettings settings)
    {
        var normalized = settings.Normalized();
        lock (_lock) _settings = normalized;
        _logger.LogInformation("Audio settings: input '{Input}' ({Channel}, gain {Gain}, denoise {Denoise}, {Bitrate} kbit/s), output '{Output}' (volume {Volume}).",
            normalized.InputDevice, normalized.InputChannel, normalized.InputGain, normalized.Denoise, normalized.BitrateKbps, normalized.OutputDevice, normalized.OutputVolume);
        _mixer.Configure(AudioEnabled ? normalized.OutputDevice : null, normalized.OutputVolume);
        ReconcileUplink();
        return Task.CompletedTask;
    }

    public Task SyncSoundFiles(SoundFileInfo[] files)
    {
        _library.Sync(files);
        return Task.CompletedTask;
    }

    // ponytail: browser-only broadcast that IConnectionHubClient declares; nothing to do here.
    public Task AudioStatusUpdated(int carId, AudioStatus status) => Task.CompletedTask;

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
        ReconcileUplink();
        return Task.CompletedTask;
    }

    /// <summary>
    /// Runs the uplink when the server wants it and a microphone is configured. Gain applies live; a change
    /// of device, channel, filter, bitrate or target restarts the ffmpeg pair.
    /// </summary>
    private void ReconcileUplink()
    {
        lock (_uplinkLock)
        {
            AudioSettings settings;
            int? port;
            MicUplink? current;
            lock (_lock) (settings, port, current) = (_settings, _uplinkPort, _uplink);

            if (port == null || string.IsNullOrWhiteSpace(settings.InputDevice) || !AudioEnabled)
            {
                if (port != null && !AudioEnabled)
                    _logger.LogInformation("Audio uplink skipped: audio is disabled (feature flag 'audio').");
                StopUplink();
                return;
            }

            var host = _configuration.GetValue<string>("ServerName");
            if (string.IsNullOrWhiteSpace(host)) host = "localhost";
            var capture = CaptureArgs(settings);
            var encoder = $"-hide_banner -loglevel error -nostats -probesize 32 -analyzeduration 0 " +
                          $"-f s16le -ar {AudioFormat.SampleRate} -ac 1 -i pipe:0 " +
                          $"-c:a libopus -b:a {settings.BitrateKbps}k -application voip -frame_duration 20 " +
                          $"-f rtp -payload_type 111 rtp://{host}:{port}?pkt_size=1200";

            if (current != null && current.CaptureArgs == capture && current.EncoderArgs == encoder)
            {
                current.Gain = settings.InputGain;
                UpdateMicMute();
                return;
            }

            StopUplink();
            var uplink = new MicUplink(_logger, capture, encoder) { Gain = settings.InputGain };
            uplink.Failed += failed =>
            {
                lock (_lock)
                {
                    if (_uplink == failed)
                        _uplink = null;
                }
            };
            lock (_lock) _uplink = uplink;
            UpdateMicMute();
            uplink.Start();
        }
    }

    private static string CaptureArgs(AudioSettings settings)
    {
        var filters = new List<string>();
        if (settings.InputChannel == AudioSettings.ChannelLeft) filters.Add("pan=mono|c0=c0");
        else if (settings.InputChannel == AudioSettings.ChannelRight) filters.Add("pan=mono|c0=c1");
        if (settings.Denoise) filters.Add(DenoiseFilter);
        var filterArgs = filters.Count > 0 ? $"-af {string.Join(',', filters)} " : "";
        // ffmpeg's ALSA input captures stereo by default (plughw converts a mono card), so left/right
        // always exist. Errors only: timestamp warnings of some devices would flood the log.
        return $"-hide_banner -loglevel error -nostats -nostdin -f alsa -i {settings.InputDevice} {filterArgs}" +
               $"-ac 1 -ar {AudioFormat.SampleRate} -f s16le -flush_packets 1 pipe:1";
    }

    private void StopUplink()
    {
        MicUplink? uplink;
        lock (_lock)
        {
            uplink = _uplink;
            _uplink = null;
        }
        uplink?.Dispose();
    }

    private void UpdateMicMute()
    {
        lock (_lock)
        {
            if (_uplink == null) return;
            var talking = _talk != null || DateTime.UtcNow - _talkEndedAt < TalkHangover;
            _uplink.Muted = _settings.MuteInputWhileTalking && talking;
        }
    }

    // -- Push-to-talk: browser → vehicle speaker --------------------------------------

    public Task<bool> StartAudioPlayback(string sessionId, string format) => Task.FromResult(StartTalk(sessionId, format));

    private bool StartTalk(string sessionId, string format)
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
        if (!_mixer.HasDevice)
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

        AbortTalk();
        PushToTalkSource talk;
        try
        {
            talk = PushToTalkSource.Start(demuxer, _logger);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start push-to-talk decoder.");
            return false;
        }
        lock (_lock)
        {
            _talk = talk;
            _lastChunkAt = DateTime.UtcNow;
        }
        if (!_mixer.Add(talk))
        {
            talk.Abort();
            lock (_lock)
            {
                if (_talk == talk) _talk = null;
            }
            return false;
        }
        UpdateMicMute();
        _controlService.MarkSessionActivity();
        return true;
    }

    public async Task PlayAudioChunk(string sessionId, byte[] chunk)
    {
        if (chunk.Length == 0 || chunk.Length > MaxChunkBytes)
            return;
        if (!_controlService.IsActiveSession(sessionId))
            return;

        PushToTalkSource? talk;
        lock (_lock)
        {
            talk = _talk;
            _lastChunkAt = DateTime.UtcNow;
        }
        if (talk == null)
            return;
        await talk.WriteAsync(chunk);
        _controlService.MarkSessionActivity();
    }

    public async Task StopAudioPlayback(string sessionId)
    {
        if (!_controlService.IsActiveSession(sessionId))
            return;
        PushToTalkSource? talk;
        lock (_lock) talk = _talk;
        // Plays out what is buffered; the source finishes on its own afterwards.
        if (talk != null)
            await talk.EndInputAsync();
    }

    private void AbortTalk()
    {
        PushToTalkSource? talk;
        lock (_lock) talk = _talk;
        talk?.Abort();
    }

    private void OnSourceFinished(IMixerSource source)
    {
        lock (_lock)
        {
            if (source != _talk) return;
            _talk = null;
            _talkEndedAt = DateTime.UtcNow;
        }
        _logger.LogInformation("Push-to-talk playback finished.");
    }

    // -- Housekeeping: watchdog, mute hangover, status --------------------------------

    private void Tick()
    {
        if (Interlocked.Exchange(ref _ticking, 1) == 1)
            return;
        try
        {
            PushToTalkSource? idleTalk = null;
            lock (_lock)
            {
                if (_talk != null && DateTime.UtcNow - _lastChunkAt > PlaybackIdleTimeout)
                {
                    idleTalk = _talk;
                    _lastChunkAt = DateTime.UtcNow;
                }
            }
            if (idleTalk != null)
            {
                _logger.LogWarning("No push-to-talk data for {Timeout}s, stopping playback.", PlaybackIdleTimeout.TotalSeconds);
                _ = idleTalk.EndInputAsync();
            }

            UpdateMicMute();
            ReportStatus();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Audio housekeeping failed.");
        }
        finally
        {
            Interlocked.Exchange(ref _ticking, 0);
        }
    }

    private void ReportStatus()
    {
        MicUplink? uplink;
        bool talking;
        lock (_lock) (uplink, talking) = (_uplink, _talk != null);
        var outputOpen = _mixer.IsOpen;
        var active = uplink != null || outputOpen || talking;
        if (!active && !_reportedActive)
            return;
        _reportedActive = active;

        var status = new AudioStatus
        {
            UplinkRunning = uplink != null,
            InputLevelDb = uplink == null ? null : AudioFormat.PeakToDb(uplink.TakePeak()),
            InputMuted = uplink?.Muted ?? false,
            OutputOpen = outputOpen,
            OutputLevelDb = AudioFormat.PeakToDb(_mixer.TakePeak()),
            Talking = talking,
            OutputVolume = _mixer.Volume,
            Sounds = _mixer.Sources.Select(s => s.Name).OfType<string>().Distinct().ToArray(),
        };
        _ = SendStatusAsync(status);
    }

    private async Task SendStatusAsync(AudioStatus status)
    {
        try
        {
            if (!_serverConnection.IsConnected)
                return;
            _server ??= _serverConnection.GetProxy();
            await _server.ReportAudioStatus(status);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to report audio status.");
        }
    }

    // -- Diagnostics ------------------------------------------------------------------

    public async Task<DiagnosticCheck[]> GetAudioDiagnostics()
    {
        var settings = Settings;
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

        var aplay = await RunToolAsync("aplay", "--version");
        Add("A3", "alsa-utils",
            aplay.ExitCode == 0 ? DiagnosticStatus.Ok : string.IsNullOrWhiteSpace(outputDevice) ? DiagnosticStatus.Warning : DiagnosticStatus.Error,
            aplay.ExitCode == 0 ? "arecord/aplay vorhanden."
                                : "alsa-utils fehlen – der Lautsprecher spielt nichts und die Geräteliste in der UI bleibt leer (apt install alsa-utils).");

        var groups = await RunToolAsync("id", "-nG");
        if (groups.ExitCode == 0)
        {
            var inAudioGroup = groups.Output.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Contains("audio");
            Add("A4", "Gruppe 'audio'", inAudioGroup ? DiagnosticStatus.Ok : DiagnosticStatus.Warning,
                inAudioGroup ? "Service-User ist in der Gruppe 'audio'."
                             : $"Service-User ({Environment.UserName}) ist nicht in der Gruppe 'audio' – ALSA-Geräte sind evtl. nicht zugreifbar (sudo usermod -aG audio {Environment.UserName}, danach Dienst neu starten).");
        }

        if (string.IsNullOrWhiteSpace(settings.InputDevice))
        {
            Add("A5", "Mikrofon", DiagnosticStatus.Info, "Kein Mikrofon konfiguriert – Mithören ist ausgeblendet.");
        }
        else
        {
            bool running;
            lock (_lock) running = _uplink != null;
            var title = $"Mikrofon ({settings.InputDevice})";
            if (running)
            {
                Add("A5", title, DiagnosticStatus.Ok, "Uplink läuft gerade (Gerät ist belegt, kein Test nötig).");
            }
            else
            {
                var test = await RunToolAsync("arecord", $"-q -D {settings.InputDevice} -f S16_LE -r 48000 -c 1 -d 1 /dev/null", TimeSpan.FromSeconds(5));
                Add("A5", title, test.ExitCode == 0 ? DiagnosticStatus.Ok : DiagnosticStatus.Error,
                    test.ExitCode == 0 ? "1 s Aufnahme erfolgreich." : $"Aufnahme fehlgeschlagen: {DescribeAlsaError(test.Error)}");
            }
        }

        if (string.IsNullOrWhiteSpace(outputDevice))
        {
            Add("A6", "Lautsprecher", DiagnosticStatus.Info, "Kein Lautsprecher konfiguriert – Push-to-Talk und Sound-Kanäle sind aus.");
        }
        else
        {
            var title = $"Lautsprecher ({outputDevice})";
            if (_mixer.IsOpen)
            {
                Add("A6", title, DiagnosticStatus.Ok, "Lautsprecher ist gerade geöffnet (Gerät ist belegt, kein Test nötig).");
            }
            else
            {
                // Plays one second of silence: proves the device opens without making noise.
                var test = await RunToolAsync("aplay", $"-q -D {outputDevice} -f S16_LE -r 48000 -c 2 -d 1 /dev/zero", TimeSpan.FromSeconds(5));
                Add("A6", title, test.ExitCode == 0 ? DiagnosticStatus.Ok : DiagnosticStatus.Error,
                    test.ExitCode == 0 ? "Gerät lässt sich öffnen (1 s Stille abgespielt)." : $"Wiedergabe fehlgeschlagen: {DescribeAlsaError(test.Error)}");
            }
        }

        return checks.ToArray();
    }

    public Task<AudioDeviceScan> ListAudioDevices() => Task.Run(() => new AudioDeviceScan
    {
        Inputs = AvailableChannelTypesService.ListAlsaDevices("arecord"),
        Outputs = AvailableChannelTypesService.ListAlsaDevices("aplay"),
    });

    public async Task<AudioDeviceTestResult> TestAudioDevice(string device, bool output)
    {
        if (!AudioEnabled)
            return new AudioDeviceTestResult { Message = "Feature-Flag 'audio' ist aus – Audio wird abgelehnt." };
        if (!IsValidDeviceName(device))
            return new AudioDeviceTestResult { Message = "Ungültiger Gerätename." };
        try
        {
            return output ? await TestSpeakerAsync(device) : await TestMicrophoneAsync(device);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Audio device test failed for {Device}", device);
            return new AudioDeviceTestResult { Message = $"Test fehlgeschlagen: {ex.Message}" };
        }
    }

    private async Task<AudioDeviceTestResult> TestMicrophoneAsync(string device)
    {
        bool running;
        lock (_lock) running = _uplink != null;
        if (running && device == Settings.InputDevice)
            return new AudioDeviceTestResult { Ok = true, Message = "Das Mikrofon sendet gerade an Zuhörer. Den Pegel siehst du beim Mithören." };

        var result = await RunPcmToolAsync("arecord", ["-q", "-D", device, "-f", "S16_LE", "-r", PcmRate, "-c", "1", "-d", "2", "-t", "raw", "-"], null);
        if (result.ExitCode != 0)
            return new AudioDeviceTestResult { Message = $"Aufnahme fehlgeschlagen: {DescribeAlsaError(result.Error)}" };

        var (peakDb, rmsDb) = MeasureLevel(result.Output);
        var message = peakDb is null or < SilentBelowDb
            ? "Aufnahme läuft, aber es kommt kein Signal an. Prüfe Stecker und Pegel."
            : "Aufnahme erfolgreich, das Mikrofon liefert Signal.";
        return new AudioDeviceTestResult { Ok = true, Message = message, PeakDb = peakDb, RmsDb = rmsDb };
    }

    private async Task<AudioDeviceTestResult> TestSpeakerAsync(string device)
    {
        if (_mixer.IsOpen && device == Settings.OutputDevice)
            return new AudioDeviceTestResult { Ok = true, Message = "Der Lautsprecher spielt gerade etwas, darum kein Testton." };

        var result = await RunPcmToolAsync("aplay", ["-q", "-D", device, "-f", "S16_LE", "-r", PcmRate, "-c", "2", "-t", "raw", "-"], BuildTestTone());
        return result.ExitCode == 0
            ? new AudioDeviceTestResult { Ok = true, Message = "Testton gesendet. Ist er am Fahrzeug zu hören?" }
            : new AudioDeviceTestResult { Message = $"Wiedergabe fehlgeschlagen: {DescribeAlsaError(result.Error)}" };
    }

    private const string PcmRate = "48000";
    private const double SilentBelowDb = -70;

    /// <summary>ALSA names only; the name goes to a tool as a single argument, but must not look like an option.</summary>
    internal static bool IsValidDeviceName(string? device) =>
        !string.IsNullOrEmpty(device) && device.Length <= 100
        && System.Text.RegularExpressions.Regex.IsMatch(device, @"^[A-Za-z0-9_][A-Za-z0-9_:=,.\-]*$");

    /// <summary>Peak and RMS of signed 16 bit little endian samples in dBFS; null on digital silence.</summary>
    internal static (double? PeakDb, double? RmsDb) MeasureLevel(ReadOnlySpan<byte> pcm)
    {
        var count = pcm.Length / 2;
        if (count == 0) return (null, null);
        var peak = 0d;
        var sum = 0d;
        for (var i = 0; i < count; i++)
        {
            var sample = (short)(pcm[i * 2] | pcm[i * 2 + 1] << 8) / 32768d;
            peak = Math.Max(peak, Math.Abs(sample));
            sum += sample * sample;
        }
        return peak == 0 ? (null, null) : (ToDb(peak), ToDb(Math.Sqrt(sum / count)));
    }

    private static double ToDb(double level) => Math.Round(20 * Math.Log10(level), 1);

    /// <summary>One second of 880 Hz at about -12 dBFS as 48 kHz stereo, faded to avoid clicks.</summary>
    internal static byte[] BuildTestTone()
    {
        const int rate = 48000;
        const int fade = rate / 50;
        var pcm = new byte[rate * 4];
        for (var i = 0; i < rate; i++)
        {
            var envelope = Math.Min(1d, Math.Min(i, rate - 1 - i) / (double)fade);
            var sample = (short)(Math.Sin(2 * Math.PI * 880 * i / rate) * envelope * 8000);
            for (var channel = 0; channel < 2; channel++)
            {
                pcm[i * 4 + channel * 2] = (byte)sample;
                pcm[i * 4 + channel * 2 + 1] = (byte)(sample >> 8);
            }
        }
        return pcm;
    }

    private static async Task<(int ExitCode, byte[] Output, string Error)> RunPcmToolAsync(string tool, string[] args, byte[]? input)
    {
        var startInfo = new ProcessStartInfo(tool)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = input != null,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var arg in args) startInfo.ArgumentList.Add(arg);
        startInfo.Environment["LC_ALL"] = "C";

        using var process = Process.Start(startInfo);
        if (process == null) return (-1, [], $"{tool} konnte nicht gestartet werden");
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        using var output = new MemoryStream();
        var stdout = process.StandardOutput.BaseStream.CopyToAsync(output, cts.Token);
        var stderr = process.StandardError.ReadToEndAsync(cts.Token);
        try
        {
            if (input != null)
            {
                try
                {
                    await process.StandardInput.BaseStream.WriteAsync(input, cts.Token);
                    process.StandardInput.Close();
                }
                catch (IOException)
                {
                    // The tool quit before reading everything, usually a busy device: its stderr says why.
                }
            }
            await process.WaitForExitAsync(cts.Token);
            await stdout;
            return (process.ExitCode, output.ToArray(), await stderr);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            return (-1, [], "Zeitüberschreitung");
        }
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
}

using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Audio;

namespace SignalRC.Onboard.Control.ControlTypes;

/// <summary>
/// Plays a file of the car's sound library on the vehicle speaker, mixed with push-to-talk and other
/// sounds. The channel value is a button: |value| ≥ 0.5 is pressed.
/// </summary>
[ControlType("SoundPlayer")]
public class SoundPlayer : ControlTypeBase
{
    private const string ModeToEnd = "toEnd";
    private const string ModeHold = "hold";
    private const string ModeToggle = "toggle";

    private readonly ILogger<SoundPlayer> _logger;
    private readonly AudioMixer _mixer;
    private readonly SoundLibrary _library;
    private readonly object _lock = new();
    private bool _pressed;
    private SoundPlayback? _current;

    /// <summary>Library file name, e.g. "horn.mp3".</summary>
    public string? File { get; set; }
    /// <summary>"toEnd" (press starts, plays to the end), "hold" (plays while pressed) or "toggle" (press starts, next press stops).</summary>
    public string Mode { get; set; } = ModeToEnd;
    /// <summary>Pressing while it plays in mode toEnd: "restart", "ignore" or "stop".</summary>
    public string Retrigger { get; set; } = "restart";
    /// <summary>Repeat until stopped.</summary>
    public bool Loop { get; set; }
    /// <summary>Volume in percent, 0–200.</summary>
    public double VolumePercent { get; set; } = 100;
    /// <summary>Start of the part to play, in seconds.</summary>
    public double StartSeconds { get; set; }
    /// <summary>End of the part to play, in seconds; 0 = to the end of the file.</summary>
    public double EndSeconds { get; set; }
    /// <summary>Fade when starting, in ms.</summary>
    public int FadeInMs { get; set; }
    /// <summary>Fade when stopping, in ms.</summary>
    public int FadeOutMs { get; set; }
    /// <summary>Quieter while push-to-talk plays.</summary>
    public bool DuckOnTalk { get; set; }

    public SoundPlayer(ILogger<SoundPlayer> logger, AudioMixer mixer, SoundLibrary library)
    {
        _logger = logger;
        _mixer = mixer;
        _library = library;
    }

    public override string ToString() => $"SoundPlayer({Name})";

    private sealed record SoundOptions(
        string? File, string Mode, string Retrigger, bool Loop, float Volume,
        double StartSeconds, double EndSeconds, int FadeInMs, int FadeOutMs, bool DuckOnTalk);

    // Edits arrive as a rebuilt channel (ControlExecutionService.Reload), so the properties are current.
    private SoundOptions ReadOptions()
    {
        var mode = Mode?.Trim().ToLowerInvariant() switch
        {
            "hold" => ModeHold,
            "toggle" => ModeToggle,
            _ => ModeToEnd,
        };
        return new SoundOptions(
            File,
            mode,
            Retrigger?.ToLowerInvariant() ?? "restart",
            Loop,
            (float)Math.Clamp(VolumePercent / 100, 0, 2),
            Math.Max(0, StartSeconds),
            Math.Max(0, EndSeconds),
            Math.Clamp(FadeInMs, 0, 60_000),
            Math.Clamp(FadeOutMs, 0, 60_000),
            DuckOnTalk);
    }

    public override void Initialize()
    {
        var options = ReadOptions();
        if (!string.IsNullOrWhiteSpace(options.File))
            _library.WarmUp(options.File, options.StartSeconds, options.EndSeconds);
    }

    public override void OnControlRecived(decimal newValue)
    {
        var pressed = Math.Abs(newValue) >= 0.5m;
        lock (_lock)
        {
            if (pressed == _pressed) return;
            _pressed = pressed;
        }

        var options = ReadOptions();
        if (!pressed)
        {
            if (options.Mode == ModeHold)
                StopCurrent();
            return;
        }

        var playing = IsPlaying;
        if (options.Mode == ModeToggle && playing)
        {
            StopCurrent();
            return;
        }
        if (options.Mode == ModeToEnd && playing)
        {
            switch (options.Retrigger)
            {
                case "ignore":
                    return;
                case "stop":
                    StopCurrent();
                    return;
            }
        }
        StopCurrent();
        Start(options);
    }

    public override void OnControlReleased()
    {
        lock (_lock) _pressed = false;
        // Control lost (session ended, connection gone): nothing may keep playing on its own forever.
        var options = ReadOptions();
        if (options.Loop || options.Mode != ModeToEnd)
            StopCurrent();
    }

    private bool IsPlaying
    {
        get
        {
            lock (_lock) return _current is { IsFinished: false };
        }
    }

    private void Start(SoundOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.File))
        {
            _logger.LogWarning("Sound channel {Name}: no 'file' option configured.", Name);
            return;
        }
        if (!_mixer.HasDevice)
        {
            _logger.LogWarning("Sound channel {Name}: no speaker configured for this vehicle.", Name);
            return;
        }
        var reader = _library.OpenReader(options.File, options.StartSeconds, options.EndSeconds);
        if (reader == null)
        {
            _logger.LogWarning("Sound channel {Name}: '{File}' is not in the local sound library (yet).", Name, options.File);
            return;
        }

        var playback = new SoundPlayback(Name, reader, _mixer, options.Volume, options.Loop, options.FadeInMs, options.FadeOutMs, options.DuckOnTalk);
        if (!_mixer.Add(playback))
        {
            playback.Abort();
            return;
        }
        lock (_lock) _current = playback;
        _logger.LogInformation("Sound channel {Name}: playing '{File}' ({Mode}{Loop}).", Name, options.File, options.Mode, options.Loop ? ", loop" : "");
    }

    private void StopCurrent()
    {
        SoundPlayback? current;
        lock (_lock)
        {
            current = _current;
            _current = null;
        }
        current?.Stop();
    }
}

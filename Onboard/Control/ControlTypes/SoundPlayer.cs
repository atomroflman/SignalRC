using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Audio;
using SignalRC.Shared.Channels;

namespace SignalRC.Onboard.Control.ControlTypes;

/// <summary>
/// Plays a file of the car's sound library on the vehicle speaker, mixed with push-to-talk and other
/// sounds. The channel value is a button: |value| ≥ 0.5 is pressed.
/// <para>Options (all optional except <c>file</c>):</para>
/// <list type="bullet">
/// <item><c>file</c>: library file name, e.g. "horn.mp3"</item>
/// <item><c>mode</c>: "toEnd" (press starts, plays to the end), "hold" (plays while pressed),
/// "toggle" (press starts, next press stops)</item>
/// <item><c>retrigger</c> (toEnd): pressing while it plays — "restart", "ignore" or "stop"</item>
/// <item><c>loop</c>: repeat until stopped</item>
/// <item><c>volumePercent</c>: 0–200, default 100</item>
/// <item><c>startSeconds</c> / <c>endSeconds</c>: play only this part (end 0 = to the end of the file)</item>
/// <item><c>fadeInMs</c> / <c>fadeOutMs</c>: fades when starting / stopping</item>
/// <item><c>duckOnTalk</c>: quieter while push-to-talk plays</item>
/// </list>
/// Options are read on every press, so edits apply without a restart.
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
    private readonly ChannelMap _channelMap;
    private readonly object _lock = new();
    private bool _pressed;
    private SoundPlayback? _current;

    public SoundPlayer(ILogger<SoundPlayer> logger, AudioMixer mixer, SoundLibrary library, ChannelMap channelMap)
    {
        _logger = logger;
        _mixer = mixer;
        _library = library;
        _channelMap = channelMap;
    }

    public override string ToString() => $"SoundPlayer({Name})";

    private sealed record SoundOptions(
        string? File, string Mode, string Retrigger, bool Loop, float Volume,
        double StartSeconds, double EndSeconds, int FadeInMs, int FadeOutMs, bool DuckOnTalk);

    private SoundOptions ReadOptions()
    {
        // The channel map holds the latest options (UI edits replace the entry); fall back to init-time ones.
        var options = _channelMap.ControlChannels.TryGetValue(Name, out var item) ? item.Options : Options;
        var mode = OptionValues.GetString(options, "mode")?.Trim().ToLowerInvariant() switch
        {
            "hold" => ModeHold,
            "toggle" => ModeToggle,
            _ => ModeToEnd,
        };
        return new SoundOptions(
            OptionValues.GetString(options, "file"),
            mode,
            OptionValues.GetString(options, "retrigger")?.ToLowerInvariant() ?? "restart",
            OptionValues.GetBool(options, "loop", false),
            (float)Math.Clamp(OptionValues.GetDouble(options, "volumePercent", 100) / 100, 0, 2),
            Math.Max(0, OptionValues.GetDouble(options, "startSeconds", 0)),
            Math.Max(0, OptionValues.GetDouble(options, "endSeconds", 0)),
            (int)Math.Clamp(OptionValues.GetDouble(options, "fadeInMs", 0), 0, 60_000),
            (int)Math.Clamp(OptionValues.GetDouble(options, "fadeOutMs", 0), 0, 60_000),
            OptionValues.GetBool(options, "duckOnTalk", false));
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

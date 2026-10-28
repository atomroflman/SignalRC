using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Audio;

/// <summary>
/// The vehicle speaker. All sources (push-to-talk, sound channels) are mixed here into one stereo stream
/// that is piped into a single <c>aplay</c>, so they play at the same time instead of fighting over the
/// ALSA device. The device is opened when the first source arrives and closed again after a few idle
/// seconds, which frees it for other programs.
/// </summary>
public sealed class AudioMixer
{
    private static readonly TimeSpan IdleLinger = TimeSpan.FromSeconds(3);
    // 80 ms ALSA buffer in 20 ms periods: low latency, still safe against short CPU stalls.
    private const string AplayBufferArgs = "--buffer-time=80000 --period-time=20000";

    private readonly ILogger<AudioMixer> _logger;
    private readonly object _lock = new();
    private readonly List<IMixerSource> _sources = new();
    private string? _device;
    private float _volume = 1f;
    private Thread? _thread;
    private int _session;
    private float _peak;
    private volatile bool _talkActive;

    public AudioMixer(ILogger<AudioMixer> logger)
    {
        _logger = logger;
    }

    /// <summary>Raised on the mixer thread when a source finished or was aborted.</summary>
    public event Action<IMixerSource>? SourceFinished;

    public bool IsOpen
    {
        get { lock (_lock) return _thread != null; }
    }

    public bool HasDevice
    {
        get { lock (_lock) return _device != null; }
    }

    public float Volume
    {
        get { lock (_lock) return _volume; }
    }

    /// <summary>Push-to-talk is among the playing sources (sound channels may duck under it).</summary>
    public bool TalkActive => _talkActive;

    public IReadOnlyList<IMixerSource> Sources
    {
        get { lock (_lock) return _sources.ToArray(); }
    }

    /// <summary>
    /// Sets the ALSA device (null = no speaker: everything stops) and the master volume. The volume applies
    /// live; a different device reopens the output and the sources continue there.
    /// </summary>
    public void Configure(string? device, float volume)
    {
        IMixerSource[] dropped = Array.Empty<IMixerSource>();
        lock (_lock)
        {
            _volume = volume;
            if (_device == device)
                return;
            _device = device;
            if (_thread != null)
                _session++; // the running thread notices and ends; a new one starts below if needed
            _thread = null;
            if (device == null)
            {
                dropped = _sources.ToArray();
                _sources.Clear();
            }
            else if (_sources.Count > 0)
            {
                StartThreadLocked();
            }
        }
        foreach (var source in dropped)
            Finish(source, abort: true);
    }

    /// <summary>
    /// Plays <paramref name="source"/>. False when no speaker is configured.
    /// </summary>
    public bool Add(IMixerSource source)
    {
        lock (_lock)
        {
            if (_device == null)
                return false;
            _sources.Add(source);
            if (_thread == null)
                StartThreadLocked();
            return true;
        }
    }

    /// <summary>Peak (linear, after volume) since the last call.</summary>
    public float TakePeak()
    {
        lock (_lock)
        {
            var peak = _peak;
            _peak = 0;
            return peak;
        }
    }

    private void StartThreadLocked()
    {
        var session = ++_session;
        var device = _device!;
        _thread = new Thread(() => Run(session, device)) { IsBackground = true, Name = "audio-mixer" };
        _thread.Start();
    }

    private void Run(int session, string device)
    {
        var mix = new float[AudioFormat.OutputFrameValues];
        var bytes = new byte[AudioFormat.OutputFrameBytes];
        var gain = Volume;
        var idleSince = Stopwatch.StartNew();
        Process? process = null;
        try
        {
            var args = $"-q -D {device} -t raw -f S16_LE -r {AudioFormat.SampleRate} -c {AudioFormat.OutputChannels} {AplayBufferArgs}";
            _logger.LogInformation("Opening speaker: aplay {Args}", args);
            process = AudioProcess.Start("aplay", args, redirectInput: true, _logger, "speaker");
            var output = process.StandardInput.BaseStream;
            AudioProcess.ShrinkPipe(output, 4096);

            while (true)
            {
                IMixerSource[] sources;
                float targetGain;
                lock (_lock)
                {
                    if (session != _session)
                        return;
                    sources = _sources.ToArray();
                    targetGain = _volume;
                }
                _talkActive = sources.Any(s => s is PushToTalkSource);

                Array.Clear(mix);
                foreach (var source in sources)
                {
                    bool alive;
                    try
                    {
                        alive = source.MixInto(mix);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Audio source {Source} failed.", source.Name ?? source.GetType().Name);
                        alive = false;
                    }
                    if (!alive)
                    {
                        lock (_lock) _sources.Remove(source);
                        Finish(source, abort: false);
                    }
                }

                // Volume changes ramp over one frame instead of jumping (no clicks).
                var step = (targetGain - gain) / mix.Length;
                var peak = 0f;
                for (var i = 0; i < mix.Length; i++)
                {
                    gain += step;
                    var v = mix[i] * gain;
                    mix[i] = v;
                    var a = Math.Abs(v);
                    if (a > peak) peak = a;
                }
                gain = targetGain;
                AudioFormat.ToS16(mix, bytes);
                lock (_lock) _peak = Math.Max(_peak, peak);

                // Blocks at the device's pace (the pipe is shrunk to one page).
                output.Write(bytes);

                if (sources.Length > 0)
                {
                    idleSince.Restart();
                }
                else if (idleSince.Elapsed > IdleLinger)
                {
                    lock (_lock)
                    {
                        if (session != _session || _sources.Count == 0)
                        {
                            if (session == _session)
                                _thread = null;
                            _talkActive = false;
                            _logger.LogInformation("Closing speaker (idle).");
                            return;
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            // aplay failed to start or died (device busy, unplugged, …): end everything that was playing,
            // the next source tries again.
            _logger.LogError("Speaker output on '{Device}' failed: {Message}", device, ex.Message);
            IMixerSource[] dropped;
            lock (_lock)
            {
                if (session != _session)
                    return;
                _thread = null;
                dropped = _sources.ToArray();
                _sources.Clear();
            }
            foreach (var source in dropped)
                Finish(source, abort: true);
        }
        finally
        {
            try
            {
                process?.StandardInput.Close();
            }
            catch
            {
                // pipe already gone
            }
            if (process != null && !process.WaitForExit(500))
                AudioProcess.Kill(process, _logger, "speaker");
            else
                process?.Dispose();
        }
    }

    private void Finish(IMixerSource source, bool abort)
    {
        if (abort)
        {
            try
            {
                source.Abort();
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Aborting audio source failed.");
            }
        }
        try
        {
            SourceFinished?.Invoke(source);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "SourceFinished handler failed.");
        }
    }
}

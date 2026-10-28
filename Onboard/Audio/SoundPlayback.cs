using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Audio;

/// <summary>
/// Decoded PCM of a sound (48 kHz stereo floats, interleaved).
/// </summary>
public interface ISoundReader : IDisposable
{
    /// <summary>
    /// Copies up to <c>target.Length</c> values. Fewer (even 0) while a stream is still starting;
    /// <paramref name="ended"/> once everything was delivered.
    /// </summary>
    int Read(Span<float> target, out bool ended);

    /// <summary>Starts over from the beginning (loop).</summary>
    void Rewind();
}

/// <summary>Cached short clip.</summary>
public sealed class MemorySoundReader(short[] samples) : ISoundReader
{
    private int _position;

    public int Read(Span<float> target, out bool ended)
    {
        var n = Math.Min(target.Length, samples.Length - _position);
        for (var i = 0; i < n; i++)
            target[i] = samples[_position + i] / 32768f;
        _position += n;
        ended = _position >= samples.Length;
        return n;
    }

    public void Rewind() => _position = 0;

    public void Dispose()
    {
    }
}

/// <summary>
/// Long file decoded on the fly by ffmpeg. A reader thread keeps a ring buffer of up to 2 s filled;
/// local files decode far faster than real time, so after the start-up it never runs dry.
/// </summary>
public sealed class StreamingSoundReader : ISoundReader
{
    private const int Capacity = AudioFormat.OutputFrameValues * 100; // 2 s

    private readonly string _args;
    private readonly ILogger _logger;
    private readonly object _lock = new();
    private readonly float[] _ring = new float[Capacity];
    private int _head;
    private int _count;
    private bool _decoderDone;
    private Process? _process;
    private int _generation;
    private bool _disposed;

    public StreamingSoundReader(string args, ILogger logger)
    {
        _args = args;
        _logger = logger;
        Start();
    }

    private void Start()
    {
        int generation;
        Process process;
        lock (_lock)
        {
            generation = ++_generation;
            _head = 0;
            _count = 0;
            _decoderDone = false;
            process = AudioProcess.Start("ffmpeg", _args, redirectInput: false, _logger, "sound stream");
            _process = process;
        }
        var thread = new Thread(() => Fill(process, generation)) { IsBackground = true, Name = "sound-stream" };
        thread.Start();
    }

    private void Fill(Process process, int generation)
    {
        var bytes = new byte[AudioFormat.OutputFrameBytes];
        var values = new float[AudioFormat.OutputFrameValues];
        try
        {
            var output = process.StandardOutput.BaseStream;
            while (true)
            {
                var read = output.ReadAtLeast(bytes, bytes.Length, throwOnEndOfStream: false);
                read -= read % (sizeof(short) * AudioFormat.OutputChannels);
                if (read <= 0)
                    break;
                var count = read / sizeof(short);
                AudioFormat.ToFloat(bytes.AsSpan(0, read), values);
                lock (_lock)
                {
                    // Full: wait for the mixer instead of dropping audio.
                    while (_count + count > Capacity && generation == _generation && !_disposed)
                        Monitor.Wait(_lock, 100);
                    if (generation != _generation || _disposed)
                        return;
                    var tail = (_head + _count) % Capacity;
                    for (var i = 0; i < count; i++)
                        _ring[(tail + i) % Capacity] = values[i];
                    _count += count;
                }
            }
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException)
        {
            // killed (rewind, stop)
        }
        finally
        {
            lock (_lock)
            {
                if (generation == _generation)
                    _decoderDone = true;
            }
        }
    }

    public int Read(Span<float> target, out bool ended)
    {
        lock (_lock)
        {
            var n = Math.Min(target.Length, _count);
            for (var i = 0; i < n; i++)
            {
                target[i] = _ring[_head];
                _head = (_head + 1) % Capacity;
            }
            _count -= n;
            ended = _decoderDone && _count == 0;
            Monitor.PulseAll(_lock);
            return n;
        }
    }

    public void Rewind()
    {
        Process? old;
        lock (_lock)
        {
            old = _process;
            _generation++;
            Monitor.PulseAll(_lock);
        }
        AudioProcess.Kill(old, _logger, "sound stream");
        Start();
    }

    public void Dispose()
    {
        Process? process;
        lock (_lock)
        {
            _disposed = true;
            process = _process;
            _process = null;
            Monitor.PulseAll(_lock);
        }
        AudioProcess.Kill(process, _logger, "sound stream");
    }
}

/// <summary>
/// One playing sound in the mixer: volume, loop, fade in/out, and optional ducking while
/// push-to-talk plays.
/// </summary>
public sealed class SoundPlayback : IMixerSource
{
    // Even without a configured fade, stopping fades over 10 ms so it doesn't click.
    private const int MinFadeOutSamples = AudioFormat.SampleRate / 100;
    private const float DuckGain = 0.25f;
    // Ducking ramps over 100 ms.
    private const float DuckStep = (1f - DuckGain) / (AudioFormat.SampleRate / 10);

    private readonly ISoundReader _reader;
    private readonly AudioMixer _mixer;
    private readonly float _volume;
    private readonly bool _loop;
    private readonly bool _duckOnTalk;
    private readonly int _fadeInSamples;
    private readonly int _fadeOutSamples;
    private readonly float[] _frame = new float[AudioFormat.OutputFrameValues];
    private readonly object _lock = new();
    private int _played;
    private bool _stopping;
    private int _fadeOutLeft;
    private float _duck = 1f;
    private bool _ended;
    // Values delivered since the last (re)start; an empty range must not loop forever.
    private long _deliveredSinceRewind;
    private volatile bool _finished;

    public SoundPlayback(string name, ISoundReader reader, AudioMixer mixer, float volume, bool loop, int fadeInMs, int fadeOutMs, bool duckOnTalk)
    {
        Name = name;
        _reader = reader;
        _mixer = mixer;
        _volume = volume;
        _loop = loop;
        _duckOnTalk = duckOnTalk;
        _fadeInSamples = Math.Max(0, fadeInMs) * AudioFormat.SampleRate / 1000;
        _fadeOutSamples = Math.Max(MinFadeOutSamples, Math.Max(0, fadeOutMs) * AudioFormat.SampleRate / 1000);
    }

    public string? Name { get; }

    public bool IsFinished => _finished;

    /// <summary>Fades out and ends.</summary>
    public void Stop()
    {
        lock (_lock)
        {
            if (_stopping) return;
            _stopping = true;
            _fadeOutLeft = _fadeOutSamples;
        }
    }

    public void Abort()
    {
        _finished = true;
        _reader.Dispose();
    }

    public bool MixInto(Span<float> mix)
    {
        if (_finished)
            return false;

        var filled = 0;
        while (filled < _frame.Length && !_ended)
        {
            var n = _reader.Read(_frame.AsSpan(filled), out var ended);
            filled += n;
            _deliveredSinceRewind += n;
            if (!ended)
            {
                if (n == 0) break; // stream still starting: play silence for the rest of the frame
                continue;
            }
            if (_loop && _deliveredSinceRewind > 0)
            {
                _reader.Rewind();
                _deliveredSinceRewind = 0;
            }
            else
            {
                _ended = true;
            }
        }
        _frame.AsSpan(filled).Clear();

        bool stopping;
        int fadeOutLeft;
        lock (_lock) (stopping, fadeOutLeft) = (_stopping, _fadeOutLeft);
        var duckTarget = _duckOnTalk && _mixer.TalkActive ? DuckGain : 1f;
        var samples = _frame.Length / AudioFormat.OutputChannels;
        for (var s = 0; s < samples; s++)
        {
            var gain = _volume;
            if (_played < _fadeInSamples)
                gain *= (float)_played / _fadeInSamples;
            if (stopping)
            {
                gain *= (float)fadeOutLeft / _fadeOutSamples;
                if (fadeOutLeft > 0) fadeOutLeft--;
            }
            if (_duck != duckTarget)
                _duck = _duck > duckTarget ? Math.Max(duckTarget, _duck - DuckStep) : Math.Min(duckTarget, _duck + DuckStep);
            gain *= _duck;
            for (var c = 0; c < AudioFormat.OutputChannels; c++)
            {
                var i = s * AudioFormat.OutputChannels + c;
                mix[i] += _frame[i] * gain;
            }
            if (filled > 0)
                _played++;
        }
        if (stopping)
        {
            lock (_lock) _fadeOutLeft = fadeOutLeft;
        }

        // Ended within this frame (it was still mixed), or the fade-out reached zero.
        if ((_ended && filled < _frame.Length) || (stopping && fadeOutLeft == 0))
            Finish();
        return !_finished;
    }

    private void Finish()
    {
        _finished = true;
        _reader.Dispose();
    }
}

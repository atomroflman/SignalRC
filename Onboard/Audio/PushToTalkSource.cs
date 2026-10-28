using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Audio;

/// <summary>
/// The driver's voice: the browser's WebM/Ogg chunks are piped into an ffmpeg decoder, its PCM lands in
/// a small jitter buffer that the mixer drains in real time. Chunks arrive in bursts (one per recorder
/// timeslice), so playback starts a little after the first burst and keeps that margin as jitter
/// reserve; if the buffer grows anyway (network hiccup), it is trimmed so the delay can't creep up.
/// </summary>
public sealed class PushToTalkSource : IMixerSource
{
    private const long StartDelayMs = 80;
    private const int MaxBufferedValues = AudioFormat.OutputFrameValues * 25; // 500 ms
    private const int TrimToValues = AudioFormat.OutputFrameValues * 8; // 160 ms
    private const int Capacity = AudioFormat.OutputFrameValues * 100; // 2 s

    private readonly ILogger _logger;
    private readonly Process _decoder;
    private readonly Stream _input;
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly object _lock = new();
    private readonly float[] _ring = new float[Capacity];
    private int _head;
    private int _count;
    private bool _started;
    // When data (re)appeared in the empty buffer; playback starts StartDelayMs later.
    private long _dataSinceMs;
    private bool _inputClosed;
    private volatile bool _decoderDone;
    private volatile bool _aborted;

    public string? Name => null;

    private PushToTalkSource(ILogger logger, Process decoder)
    {
        _logger = logger;
        _decoder = decoder;
        _input = decoder.StandardInput.BaseStream;
        var output = decoder.StandardOutput.BaseStream;
        _ = Task.Run(() => ReadDecoderOutput(output));
    }

    /// <summary>
    /// Starts the decoder for <paramref name="demuxer"/> ("matroska" or "ogg").
    /// </summary>
    public static PushToTalkSource Start(string demuxer, ILogger logger)
    {
        var args = $"-hide_banner -loglevel warning -nostats -fflags nobuffer -flags low_delay " +
                   $"-probesize 4096 -analyzeduration 0 -f {demuxer} -i pipe:0 " +
                   $"-f s16le -ar {AudioFormat.SampleRate} -ac {AudioFormat.OutputChannels} -flush_packets 1 pipe:1";
        logger.LogInformation("Starting push-to-talk decoder: ffmpeg {Args}", args);
        return new PushToTalkSource(logger, AudioProcess.Start("ffmpeg", args, redirectInput: true, logger, "push-to-talk"));
    }

    /// <summary>One chunk of the recorded container stream, in recording order.</summary>
    public async Task WriteAsync(byte[] chunk)
    {
        await _writeLock.WaitAsync();
        try
        {
            if (_inputClosed || _aborted)
                return;
            await _input.WriteAsync(chunk);
            await _input.FlushAsync();
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException)
        {
            _logger.LogWarning("Push-to-talk decoder pipe closed: {Message}", ex.Message);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    /// <summary>
    /// No more chunks: the decoder drains what it has, the source plays it out and then finishes.
    /// </summary>
    public async Task EndInputAsync()
    {
        await _writeLock.WaitAsync();
        try
        {
            if (_inputClosed) return;
            _inputClosed = true;
            _input.Close();
        }
        catch
        {
            // pipe already gone
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public void Abort()
    {
        _aborted = true;
        AudioProcess.Kill(_decoder, _logger, "push-to-talk");
    }

    public bool MixInto(Span<float> mix)
    {
        if (_aborted)
            return false;
        lock (_lock)
        {
            if (!_started)
            {
                if (_count == 0 || (!_decoderDone && Environment.TickCount64 - _dataSinceMs < StartDelayMs))
                    return _count > 0 || !_decoderDone;
                _started = true;
            }
            if (_count > MaxBufferedValues)
                Skip(_count - TrimToValues);

            var n = Math.Min(_count, mix.Length);
            for (var i = 0; i < n; i++)
            {
                mix[i] += _ring[_head];
                _head = (_head + 1) % Capacity;
            }
            _count -= n;
            // Ran dry mid-sentence (late chunk): rebuild the margin instead of stuttering frame by frame.
            if (_count == 0 && !_decoderDone)
                _started = false;
            return _count > 0 || !_decoderDone;
        }
    }

    private void Skip(int values)
    {
        values -= values % AudioFormat.OutputChannels; // keep left/right in step
        _head = (_head + values) % Capacity;
        _count -= values;
    }

    private void ReadDecoderOutput(Stream output)
    {
        var bytes = new byte[AudioFormat.OutputFrameBytes];
        var values = new float[AudioFormat.OutputFrameValues];
        try
        {
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
                    if (_count == 0)
                        _dataSinceMs = Environment.TickCount64;
                    if (_count + count > Capacity)
                        Skip(_count + count - Capacity);
                    var tail = (_head + _count) % Capacity;
                    for (var i = 0; i < count; i++)
                        _ring[(tail + i) % Capacity] = values[i];
                    _count += count;
                }
            }
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException)
        {
            // decoder killed
        }
        finally
        {
            _decoderDone = true;
            try
            {
                _decoder.WaitForExit(1000);
                _decoder.Dispose();
            }
            catch
            {
                // already disposed by Abort
            }
        }
    }
}

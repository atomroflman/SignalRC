using System.Runtime.InteropServices;

namespace SignalRC.Onboard.Audio;

/// <summary>
/// PCM format inside the audio engine: 48 kHz signed 16 bit little endian, processed in 20 ms frames.
/// The speaker side is stereo (interleaved), the microphone side mono.
/// </summary>
public static class AudioFormat
{
    public const int SampleRate = 48000;
    public const int FrameSamples = SampleRate / 50; // 20 ms per channel
    public const int OutputChannels = 2;
    /// <summary>Interleaved values of one speaker frame.</summary>
    public const int OutputFrameValues = FrameSamples * OutputChannels;
    public const int OutputFrameBytes = OutputFrameValues * sizeof(short);
    /// <summary>Bytes of one mono microphone frame.</summary>
    public const int InputFrameBytes = FrameSamples * sizeof(short);

    public static void ToFloat(ReadOnlySpan<byte> s16, Span<float> target)
    {
        var samples = MemoryMarshal.Cast<byte, short>(s16);
        for (var i = 0; i < samples.Length; i++)
            target[i] = samples[i] / 32768f;
    }

    public static void ToS16(ReadOnlySpan<float> source, Span<byte> target)
    {
        var samples = MemoryMarshal.Cast<byte, short>(target);
        for (var i = 0; i < source.Length; i++)
            samples[i] = (short)Math.Clamp(source[i] * 32767f, -32768f, 32767f);
    }

    /// <summary>dBFS of a linear peak; null for (near) silence, which JSON can't express as -∞.</summary>
    public static float? PeakToDb(float peak) => peak < 0.00003f ? null : 20f * MathF.Log10(Math.Min(peak, 1f));
}

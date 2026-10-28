using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Audio;

/// <summary>
/// The vehicle microphone on its way to Janus: ffmpeg captures from ALSA (channel pick and denoise
/// filters) and hands raw PCM to this class, which applies the gain and the push-to-talk mute live,
/// then a second ffmpeg encodes Opus and sends RTP. Gain and mute change without restarting anything;
/// a change of device, filters, bitrate or target means a new instance.
/// </summary>
public sealed class MicUplink : IDisposable
{
    private static readonly TimeSpan RestartDelay = TimeSpan.FromSeconds(2);
    // Mute fades over 10 ms so it doesn't click.
    private const float MuteStep = 1f / (AudioFormat.SampleRate / 100);

    private readonly ILogger _logger;
    private readonly CancellationTokenSource _cts = new();
    private readonly object _lock = new();
    private Process? _capture;
    private Process? _encoder;
    private float _gain = 1f;
    private bool _muted;
    private float _peak;

    public string CaptureArgs { get; }
    public string EncoderArgs { get; }

    /// <summary>Raised when ffmpeg can't be started at all; the owner drops this instance.</summary>
    public event Action<MicUplink>? Failed;

    public MicUplink(ILogger logger, string captureArgs, string encoderArgs)
    {
        _logger = logger;
        CaptureArgs = captureArgs;
        EncoderArgs = encoderArgs;
    }

    public float Gain
    {
        get { lock (_lock) return _gain; }
        set { lock (_lock) _gain = value; }
    }

    public bool Muted
    {
        get { lock (_lock) return _muted; }
        set { lock (_lock) _muted = value; }
    }

    /// <summary>Peak (linear, after gain, before mute) since the last call.</summary>
    public float TakePeak()
    {
        lock (_lock)
        {
            var peak = _peak;
            _peak = 0;
            return peak;
        }
    }

    public void Start()
    {
        _logger.LogInformation("Starting audio uplink: capture ffmpeg {Capture} | encoder ffmpeg {Encoder}", CaptureArgs, EncoderArgs);
        var thread = new Thread(Run) { IsBackground = true, Name = "audio-uplink" };
        thread.Start();
    }

    private void Run()
    {
        var token = _cts.Token;
        var bytes = new byte[AudioFormat.InputFrameBytes];
        var samples = new float[AudioFormat.FrameSamples];
        var muteFactor = 1f;
        while (!token.IsCancellationRequested)
        {
            Process capture, encoder;
            try
            {
                capture = AudioProcess.Start("ffmpeg", CaptureArgs, redirectInput: false, _logger, "capture");
                try
                {
                    encoder = AudioProcess.Start("ffmpeg", EncoderArgs, redirectInput: true, _logger, "encoder");
                }
                catch
                {
                    AudioProcess.Kill(capture, _logger, "capture");
                    throw;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to start audio uplink ffmpeg; the next listener retries.");
                Failed?.Invoke(this);
                return;
            }
            lock (_lock)
            {
                _capture = capture;
                _encoder = encoder;
            }
            if (token.IsCancellationRequested)
            {
                StopProcesses();
                return;
            }

            try
            {
                var input = capture.StandardOutput.BaseStream;
                var output = encoder.StandardInput.BaseStream;
                while (!token.IsCancellationRequested)
                {
                    if (input.ReadAtLeast(bytes, bytes.Length, throwOnEndOfStream: false) < bytes.Length)
                        break;
                    AudioFormat.ToFloat(bytes, samples);

                    float gain;
                    bool muted;
                    lock (_lock) (gain, muted) = (_gain, _muted);
                    var target = muted ? 0f : 1f;
                    var peak = 0f;
                    for (var i = 0; i < samples.Length; i++)
                    {
                        var v = samples[i] * gain;
                        var a = Math.Abs(v);
                        if (a > peak) peak = a;
                        if (muteFactor != target)
                            muteFactor = target > muteFactor ? Math.Min(target, muteFactor + MuteStep) : Math.Max(target, muteFactor - MuteStep);
                        samples[i] = v * muteFactor;
                    }
                    lock (_lock) _peak = Math.Max(_peak, peak);

                    AudioFormat.ToS16(samples, bytes);
                    output.Write(bytes);
                }
            }
            catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException)
            {
                // one of the processes died or was killed
            }

            var exitCode = SafeExitCode(capture);
            StopProcesses();
            if (token.IsCancellationRequested)
                return;
            _logger.LogWarning("Audio uplink ffmpeg stopped (capture exit {Capture}); restarting in {Delay}s.",
                exitCode, RestartDelay.TotalSeconds);
            if (token.WaitHandle.WaitOne(RestartDelay))
                return;
        }
    }

    private static string SafeExitCode(Process process)
    {
        try
        {
            return process.HasExited ? process.ExitCode.ToString() : "running";
        }
        catch
        {
            return "?";
        }
    }

    private void StopProcesses()
    {
        Process? capture, encoder;
        lock (_lock)
        {
            (capture, encoder) = (_capture, _encoder);
            _capture = null;
            _encoder = null;
        }
        AudioProcess.Kill(capture, _logger, "capture");
        AudioProcess.Kill(encoder, _logger, "encoder");
    }

    public void Dispose()
    {
        _cts.Cancel();
        StopProcesses();
        _logger.LogInformation("Audio uplink stopped.");
    }
}

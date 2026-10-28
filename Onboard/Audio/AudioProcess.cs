using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Audio;

/// <summary>
/// Starting and stopping the ffmpeg/aplay helper processes of the audio engine.
/// </summary>
public static class AudioProcess
{
    private const int F_SETPIPE_SZ = 1031;

    [DllImport("libc", SetLastError = true)]
    private static extern int fcntl(int fd, int cmd, int arg);

    /// <summary>
    /// Starts <paramref name="tool"/> with stdout/stderr captured (stderr goes to the log as warnings).
    /// </summary>
    public static Process Start(string tool, string args, bool redirectInput, ILogger logger, string role)
    {
        var process = new Process
        {
            StartInfo = new ProcessStartInfo(tool, args)
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
                logger.LogWarning("{Tool} audio {Role}: {Line}", tool, role, e.Data);
        };
        process.Start();
        process.BeginErrorReadLine();
        return process;
    }

    public static void Kill(Process? process, ILogger logger, string role)
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
            logger.LogWarning(ex, "Failed to stop audio {Role} process.", role);
        }
    }

    /// <summary>
    /// Shrinks a pipe to one page (Linux default is 64 KiB ≈ 340 ms of stereo audio). A blocking writer
    /// then runs exactly at the reader's pace, so the speaker latency stays at the ALSA buffer.
    /// Best effort: on other systems the pipe just stays large.
    /// </summary>
    public static void ShrinkPipe(Stream stream, int bytes)
    {
        if (stream is not PipeStream pipe || !OperatingSystem.IsLinux())
            return;
        try
        {
            fcntl((int)pipe.SafePipeHandle.DangerousGetHandle(), F_SETPIPE_SZ, bytes);
        }
        catch
        {
            // libc not resolvable — keep the default size.
        }
    }
}

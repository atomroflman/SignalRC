using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Update;

namespace SignalRC.Onboard.Update;

/// <summary>
/// Downloads a package into <see cref="ReleaseLayout.DownloadDirectory"/>, checks its
/// SHA256 and unpacks it as a new release folder. Never touches an installed release
/// or <see cref="ReleaseLayout.CurrentLink"/>.
/// </summary>
public class ReleaseInstaller
{
    private const int DownloadAttempts = 3;

    private readonly HttpClient _http;
    private readonly ReleaseLayout _layout;
    private readonly ILogger _logger;

    /// <summary>Pause between download attempts; tests shorten it.</summary>
    public TimeSpan RetryDelay { get; init; } = TimeSpan.FromSeconds(5);

    public ReleaseInstaller(HttpClient http, ReleaseLayout layout, ILogger logger)
    {
        _http = http;
        _layout = layout;
        _logger = logger;
    }

    /// <summary>Downloads (resuming a partial file), verifies and unpacks <paramref name="package"/> as release <paramref name="name"/>.</summary>
    public async Task InstallAsync(Uri packageUri, OnboardPackageInfo package, string name, Func<int, Task> progress, CancellationToken cancellationToken = default)
    {
        var zip = await DownloadAsync(packageUri, package, name, progress, cancellationToken);
        Extract(zip, name);
        File.Delete(zip);
    }

    private async Task<string> DownloadAsync(Uri uri, OnboardPackageInfo package, string name, Func<int, Task> progress, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_layout.DownloadDirectory);
        var path = Path.Combine(_layout.DownloadDirectory, name + ".zip");

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await DownloadOnceAsync(uri, path, package.Size, progress, cancellationToken);
                if (await VerifyAsync(path, package.Sha256, cancellationToken)) return path;
                File.Delete(path);
                throw new InvalidDataException("Die Prüfsumme des Pakets stimmt nicht.");
            }
            catch (Exception ex) when (attempt < DownloadAttempts && !cancellationToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Download attempt {Attempt} of {Url} failed", attempt, uri);
                await Task.Delay(RetryDelay * attempt, cancellationToken);
            }
        }
    }

    /// <summary>Continues a partial download with a Range request, so a broken LTE link does not start over.</summary>
    private async Task DownloadOnceAsync(Uri uri, string path, long size, Func<int, Task> progress, CancellationToken cancellationToken)
    {
        var existing = File.Exists(path) ? new FileInfo(path).Length : 0;
        if (size > 0 && existing >= size) return;

        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        if (existing > 0) request.Headers.Range = new RangeHeaderValue(existing, null);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(15));
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        response.EnsureSuccessStatusCode();
        // A server without range support sends the whole file again.
        var append = existing > 0 && response.StatusCode == HttpStatusCode.PartialContent;
        var written = append ? existing : 0;

        await using var source = await response.Content.ReadAsStreamAsync(timeout.Token);
        await using var file = new FileStream(path, append ? FileMode.Append : FileMode.Create, FileAccess.Write);
        var buffer = new byte[81920];
        var lastStep = -1;
        int read;
        while ((read = await source.ReadAsync(buffer, timeout.Token)) > 0)
        {
            await file.WriteAsync(buffer.AsMemory(0, read), timeout.Token);
            written += read;
            var percent = size > 0 ? (int)Math.Min(100, written * 100 / size) : 0;
            if (percent / 5 != lastStep)
            {
                lastStep = percent / 5;
                await progress(percent);
            }
        }
    }

    private static async Task<bool> VerifyAsync(string path, string sha256, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var actual = Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, cancellationToken));
        return string.Equals(actual, sha256, StringComparison.OrdinalIgnoreCase);
    }

    private void Extract(string zip, string name)
    {
        var temp = _layout.ReleaseDirectory(name) + ".tmp";
        if (Directory.Exists(temp)) Directory.Delete(temp, recursive: true);
        ZipFile.ExtractToDirectory(zip, temp);
        if (!File.Exists(Path.Combine(temp, ReleaseLayout.EntryAssembly)))
        {
            Directory.Delete(temp, recursive: true);
            throw new InvalidDataException($"Im Paket fehlt {ReleaseLayout.EntryAssembly}.");
        }
        var final = _layout.ReleaseDirectory(name);
        if (Directory.Exists(final)) Directory.Delete(final, recursive: true);
        Directory.Move(temp, final);
        // The install time orders releases for pruning.
        Directory.SetLastWriteTimeUtc(final, DateTime.UtcNow);
        _logger.LogInformation("Installed release {Release} at {Path}", name, final);
    }
}

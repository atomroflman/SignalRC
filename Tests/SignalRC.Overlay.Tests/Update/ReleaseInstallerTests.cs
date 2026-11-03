using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard.Update;
using SignalRC.Shared.Update;

namespace SignalRC.Overlay.Tests.Update;

/// <summary>Download, check and unpack of an onboard package against a real HTTP server with range support.</summary>
public class ReleaseInstallerTests : IDisposable
{
    private const string Release = "222222222222";

    private readonly string _root = Directory.CreateTempSubdirectory("signalrc-installer-").FullName;
    private readonly ReleaseLayout _layout;
    private readonly PackageServer _server;
    private readonly HttpClient _http = new();

    public ReleaseInstallerTests()
    {
        _layout = new ReleaseLayout(Path.Combine(_root, "Onboard"));
        _server = new PackageServer();
    }

    public void Dispose()
    {
        _server.Dispose();
        _http.Dispose();
        Directory.Delete(_root, recursive: true);
    }

    private ReleaseInstaller Installer() => new(_http, _layout, NullLogger.Instance) { RetryDelay = TimeSpan.FromMilliseconds(10) };

    private static byte[] Package(bool withEntryAssembly = true)
    {
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            if (withEntryAssembly)
            {
                using var dll = zip.CreateEntry(ReleaseLayout.EntryAssembly, CompressionLevel.NoCompression).Open();
                // Incompressible, so the ZIP is big enough to be resumed in the middle.
                dll.Write(RandomNumberGenerator.GetBytes(300_000));
            }
            using var other = new StreamWriter(zip.CreateEntry("Tools/video_stack_check.py").Open());
            other.Write("print('ok')");
        }
        return buffer.ToArray();
    }

    private static OnboardPackageInfo Info(byte[] bytes, string? sha256 = null) => new()
    {
        Url = "/api/onboard/packages/linux-arm64",
        Sha256 = sha256 ?? Convert.ToHexStringLower(SHA256.HashData(bytes)),
        Size = bytes.Length,
        Framework = "10.0.0",
    };

    [Fact]
    public async Task InstallsReleaseAndReportsProgress()
    {
        var bytes = Package();
        _server.Content = bytes;
        var progress = new List<int>();

        await Installer().InstallAsync(_server.Uri, Info(bytes), Release, p => { progress.Add(p); return Task.CompletedTask; });

        Assert.True(_layout.HasRelease(Release));
        Assert.True(File.Exists(Path.Combine(_layout.ReleaseDirectory(Release), "Tools", "video_stack_check.py")));
        Assert.Equal(100, progress[^1]);
        Assert.Equal(progress.OrderBy(p => p), progress);
        Assert.Empty(Directory.GetFiles(_layout.DownloadDirectory));
        Assert.Empty(Directory.GetDirectories(_layout.ReleasesDirectory, "*.tmp"));
        // Installing does not switch.
        Assert.Null(_layout.ReadCurrent());
    }

    [Fact]
    public async Task ResumesPartialDownloadWithRange()
    {
        var bytes = Package();
        _server.Content = bytes;
        Directory.CreateDirectory(_layout.DownloadDirectory);
        var half = bytes.Length / 2;
        await File.WriteAllBytesAsync(Path.Combine(_layout.DownloadDirectory, Release + ".zip"), bytes[..half]);

        await Installer().InstallAsync(_server.Uri, Info(bytes), Release, _ => Task.CompletedTask);

        Assert.True(_layout.HasRelease(Release));
        Assert.Equal($"bytes={half}-", Assert.Single(_server.RangeHeaders));
    }

    [Fact]
    public async Task WrongChecksumInstallsNothing()
    {
        var bytes = Package();
        _server.Content = bytes;

        var error = await Assert.ThrowsAsync<InvalidDataException>(() =>
            Installer().InstallAsync(_server.Uri, Info(bytes, sha256: new string('0', 64)), Release, _ => Task.CompletedTask));

        Assert.Contains("Prüfsumme", error.Message);
        Assert.False(_layout.HasRelease(Release));
        Assert.Equal(3, _server.Requests);
        Assert.Empty(Directory.GetFiles(_layout.DownloadDirectory));
    }

    [Fact]
    public async Task PackageWithoutOnboardIsRejected()
    {
        var bytes = Package(withEntryAssembly: false);
        _server.Content = bytes;

        await Assert.ThrowsAsync<InvalidDataException>(() =>
            Installer().InstallAsync(_server.Uri, Info(bytes), Release, _ => Task.CompletedTask));

        Assert.False(Directory.Exists(_layout.ReleaseDirectory(Release)));
        Assert.Empty(Directory.GetDirectories(_layout.ReleasesDirectory, "*.tmp"));
    }

    /// <summary>Serves <see cref="Content"/> with Range support, like PhysicalFile(enableRangeProcessing).</summary>
    private sealed class PackageServer : IDisposable
    {
        private readonly HttpListener _listener = new();
        public byte[] Content { get; set; } = Array.Empty<byte>();
        public List<string> RangeHeaders { get; } = new();
        public int Requests;
        public Uri Uri { get; }

        public PackageServer()
        {
            var probe = new TcpListener(IPAddress.Loopback, 0);
            probe.Start();
            var port = ((IPEndPoint)probe.LocalEndpoint).Port;
            probe.Stop();
            Uri = new Uri($"http://127.0.0.1:{port}/api/onboard/packages/linux-arm64");
            _listener.Prefixes.Add($"http://127.0.0.1:{port}/");
            _listener.Start();
            _ = Task.Run(ServeAsync);
        }

        private async Task ServeAsync()
        {
            while (_listener.IsListening)
            {
                HttpListenerContext context;
                try { context = await _listener.GetContextAsync(); }
                catch { return; }
                Interlocked.Increment(ref Requests);
                var range = context.Request.Headers["Range"];
                var start = 0;
                if (range != null)
                {
                    lock (RangeHeaders) RangeHeaders.Add(range);
                    start = int.Parse(range["bytes=".Length..].TrimEnd('-'));
                    context.Response.StatusCode = 206;
                    context.Response.AddHeader("Content-Range", $"bytes {start}-{Content.Length - 1}/{Content.Length}");
                }
                context.Response.ContentLength64 = Content.Length - start;
                await context.Response.OutputStream.WriteAsync(Content.AsMemory(start));
                context.Response.Close();
            }
        }

        public void Dispose() => _listener.Close();
    }
}

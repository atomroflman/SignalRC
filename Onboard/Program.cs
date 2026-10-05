using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Spectre.Console;
using LteCar.Onboard;
using LteCar.Onboard.Control;
using LteCar.Onboard.Control.ControlTypes;
using LteCar.Onboard.Data;
using LteCar.Onboard.Hardware;
using LteCar.Onboard.Services;
using LteCar.Onboard.Telemetry;
using LteCar.Onboard.Video;
using LteCar.Shared.Channels;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Configuration;

var configDirEnv = Environment.GetEnvironmentVariable("CONFIG_DIR");
var configDirArg = args.FirstOrDefault(a => a.StartsWith("--config-dir="))?.Split('=', 2, StringSplitOptions.TrimEntries)[1];
var defaultConfigDir = Directory.GetCurrentDirectory();
// Setup-Modus prüfen
if (args.Length > 0 && args[0].Equals("setup", StringComparison.OrdinalIgnoreCase))
{
    var setupConfigLoader = new ConfigLoader(defaultConfigDir, configDirArg ?? configDirEnv);
    LteCar.Onboard.Setup.SetupMenu.Run(setupConfigLoader);
    return;
}

// Telemetry-Probe-Modus: liest konfigurierte Reader lokal und zeigt Werte an,
// ohne eine Serververbindung aufzubauen oder irgendetwas zu senden.
if (args.Length > 0 && args[0].Equals("telemetry-probe", StringComparison.OrdinalIgnoreCase))
{
    var probeConfigLoader = new ConfigLoader(defaultConfigDir, configDirArg ?? configDirEnv);
    await LteCar.Onboard.Telemetry.TelemetryProbeTool.RunAsync(probeConfigLoader);
    return;
}

// Update-Modus: git pull + dotnet publish + systemctl restart (falls Service vorhanden).
// Siehe Onboard/Update/UpdateTool.cs.
if (args.Length > 0 && args[0].Equals("update", StringComparison.OrdinalIgnoreCase))
{
    var exitCode = await LteCar.Onboard.Update.UpdateTool.RunAsync(configDirArg ?? configDirEnv ?? defaultConfigDir);
    Environment.Exit(exitCode);
}

var configLoader = new ConfigLoader(defaultConfigDir, configDirArg ?? configDirEnv);

if (configDirArg != null || configDirEnv != null)
{
    Console.WriteLine($"Using config directory: {configLoader.ConfigDir}");
}

var carIdentityKey = CarIdentityService.ResolveCarIdentityKey();
var startupTime = DateTime.Now;

// Generate SSH key pair only if no public key exists
var sshKeyPath = configLoader.SshKeyPath;
var sshPublicKeyPath = configLoader.SshPublicKeyPath;
if (!File.Exists(sshPublicKeyPath))
{
    Console.WriteLine("Generating SSH key pair for vehicle authentication...");
    GenerateSshKeyPair(sshKeyPath, sshPublicKeyPath);
    Console.WriteLine($"SSH key pair generated. Public key: {File.ReadAllText(sshPublicKeyPath)}");
}
else
{
    Console.WriteLine("SSH public key already exists, skipping generation.");
}

Console.WriteLine($"Car Identity Key: {carIdentityKey}");

var configuration = new ConfigurationBuilder()
    .SetBasePath(configLoader.ConfigDir)
    .AddInMemoryCollection(new Dictionary<string, string?>() {
        { "CarIdentityKey", carIdentityKey }
    })
    .AddJsonFile("appSettings.json", optional: false)
    .AddJsonFile("appSettings.development.json", optional: true)
    .AddEnvironmentVariables()
    .Build();

ChannelMap channelMap;
var channelsDbPath = Path.Combine(configLoader.ConfigDir, "channels.sqlite");
var channelStoreLogger = LoggerFactory.Create(b => b.AddConsole()).CreateLogger<OnboardChannelStore>();
var channelStore = new OnboardChannelStore(channelsDbPath, channelStoreLogger);

if (File.Exists(channelsDbPath))
{
    await channelStore.InitializeAsync();
    channelMap = await channelStore.LoadAsync();
    AnsiConsole.MarkupLine($"[green]Loaded channel map from SQLite ({channelMap.ControlChannels.Count} control, {channelMap.TelemetryChannels.Count} telemetry, {channelMap.VideoStreams.Count} video)[/]");
}
else
{
    channelMap = (await configLoader.LoadConfigsAsync())!;
    if (channelMap == null)
        throw new Exception("channelMap.json could not be loaded");
    await channelStore.InitializeAsync();
    await channelStore.ReplaceAllAsync(channelMap);
    AnsiConsole.MarkupLine($"[green]Migrated channelMap.json to SQLite at {channelsDbPath}[/]");
}

var serviceCollection = new ServiceCollection();
// Configuration
serviceCollection.AddSingleton<ChannelMap>(channelMap);
serviceCollection.AddSingleton<IConfiguration>(configuration);
serviceCollection.AddSingleton(channelStore);
serviceCollection.AddSingleton(configLoader);

// Hub Connections
serviceCollection.AddSingleton<IOnboardBuildInfoService, OnboardBuildInfoService>();
serviceCollection.AddSingleton<ServerConnectionService>();
serviceCollection.AddSingleton<AvailableChannelTypesService>();
serviceCollection.AddSingleton<IMediaMtxConfigurator, MediaMtxConfigurator>();
serviceCollection.AddSingleton<VideoStreamService>();
serviceCollection.AddSingleton<ServerCarConfigurationService>();
serviceCollection.AddSingleton<ControlService>();
serviceCollection.AddSingleton<TelemetryService>();
serviceCollection.AddSingleton<BashToolService>();
serviceCollection.AddSingleton<OnboardDiagnosticsService>();

serviceCollection.AddSingleton<SshKeyService>();
serviceCollection.AddSingleton<TlsCertificateService>();
serviceCollection.AddSingleton<ControlExecutionService>();
serviceCollection.AddSingleton<TelemetryStore>();
serviceCollection.AddTransient<Bash>();
serviceCollection.AddSingleton<IModuleManagerFactory, ModuleManagerFactory>();
serviceCollection.AddAllTransient(typeof(TelemetryReaderBase));
serviceCollection.AddAllTransient(typeof(ControlTypeBase));
serviceCollection.AddAllTransient(typeof(IPwmModule));
serviceCollection.AddAllTransient(typeof(IGpioModule));
serviceCollection.AddLogging(c => {
    c.AddConsole(); 
    c.AddConfiguration(configuration.GetSection("Logging"));
});

var serviceProvider = serviceCollection.BuildServiceProvider();
var logger = serviceProvider.GetRequiredService<ILogger<Program>>();
logger.LogDebug("Debug log enabled...");

var configService = serviceProvider.GetRequiredService<ServerCarConfigurationService>();
configService.OnConfigurationChanged += () =>
{
    var config = configService.Configuration;
    logger.LogInformation($"Configuration changed to: {JsonSerializer.Serialize(config)}");
};
// Log key fingerprints at startup
try
{
    var sshLogService = serviceProvider.GetRequiredService<SshKeyService>();
    sshLogService.LogKeyFingerprints();
}
catch (Exception ex)
{
    logger.LogError(ex, "Failed to log key fingerprints at startup");
}
var connectionService = serviceProvider.GetRequiredService<ServerConnectionService>();
var carControlService = serviceProvider.GetRequiredService<ControlService>();

if (configuration.GetValue<bool>("EnableChannelTest")) 
{
    logger.LogInformation("Running channel test...");
    await carControlService.TestControlsAsync();
}

await connectionService.ConnectToServer(carIdentityKey);

// Initialize BashTool if enabled
var bashToolService = serviceProvider.GetRequiredService<BashToolService>();
var bashEnabled = configuration.GetValue<bool?>("bashTool") ?? false;
if (bashEnabled)
{
    var serverUrl = $"{((configuration.GetValue<bool?>("UseHttps") ?? true) ? "https" : "http")}://{configuration.GetValue<string>("ServerName")}:{configuration.GetValue<int?>("ServerPort") ?? 5000}";
    bashToolService.SetEnabled(true);
    await bashToolService.ConnectToServer(serverUrl, carIdentityKey);
    logger.LogInformation("BashToolService connected to server");
}
else
{
    bashToolService.SetEnabled(false);
    logger.LogInformation("BashToolService is disabled");
}

// Try load previous sync (contains server IDs) before optional sync
var hadPreviousSync = connectionService.TryLoadPreviousSync();
if (!hadPreviousSync)
{
    await connectionService.SyncChannelMapAsync();
}
// Connect control (will trigger sync if server hash mismatch)
// Initialize Car incatance if needed
await carControlService.ConnectToServer();
logger.LogInformation($"Car Engine Started...");

// Initialize Car remote control
logger.LogInformation("Initializing car control...");
carControlService.Initialize();

// Initialize video streaming
var videoStreamService = serviceProvider.GetRequiredService<VideoStreamService>();
logger.LogInformation("Initializing video streaming...");
await videoStreamService.Connect();

// SECURITY: this listener is the ONLY supported path for the private SSH
// key to leave the Onboard. It is bound to the LAN-only "+:8080" prefix
// and only reachable from the same network as the vehicle. The key MUST
// NOT be exposed through SignalR, REST, WebSocket, or any Server-routed
// channel — those traverse the public-internet Server and would leak it
// to any browser session. See SshKeyService.cs for the matching doc.
// One-shot: starts only while ssh_key still exists; deletes the file on
// first successful fetch so a second fetch always returns 404. The HTTPS
// listener (8443) exists so browsers can `fetch()` from an HTTPS page without
// mixed-content blocking — Firefox gates "Fetch via UI" because it's the only
// mainstream browser that lets the user permanently accept a self-signed
// exception. HTTP (8080) stays for curl users and LAN scripts.
var keyDownloaded = !File.Exists(sshKeyPath);
if (!keyDownloaded)
{
    var keepPrivateKey = configuration.GetValue<bool>("KeepPrivateKey");
    var tlsCertService = serviceProvider.GetRequiredService<TlsCertificateService>();
    var tlsCert = tlsCertService.GetOrCreateCertificate();

    // ponytail: shared decision logic for both listeners. Caller wraps
    // the result in whatever wire format (HTTP/1.1 status line for raw
    // sockets, HttpListenerResponse for HttpListener). HTTPS handshake
    // uses the cert we just loaded; nothing in the body differs.
    static (int Status, string ContentType, byte[] Body, bool Deleted) DecideSshKeyResponse(
        string method, string pathAndQuery,
        string sshKeyPath, string carIdentityKey, bool keepPrivateKey, ILogger logger)
    {
        if (string.Equals(method, "OPTIONS", StringComparison.OrdinalIgnoreCase))
            return (200, "", Array.Empty<byte>(), false);

        var qIdx = pathAndQuery.IndexOf('?');
        var path = qIdx < 0 ? pathAndQuery : pathAndQuery[..qIdx];
        if (path != "/ssh-key")
            return (404, "", Array.Empty<byte>(), false);

        var query = qIdx < 0 ? "" : pathAndQuery[(qIdx + 1)..];
        string? hash = null;
        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=');
            if (eq <= 0) continue;
            var key = Uri.UnescapeDataString(pair[..eq]);
            if (string.Equals(key, "hash", StringComparison.Ordinal))
            {
                hash = Uri.UnescapeDataString(pair[(eq + 1)..]);
                break;
            }
        }
        if (string.IsNullOrEmpty(hash))
            return (400, "text/plain", Encoding.UTF8.GetBytes("Missing identity hash parameter"), false);

        var actualHash = LteCar.Shared.HashUtility.GenerateSha256Hash(carIdentityKey);
        if (!string.Equals(actualHash, hash, StringComparison.OrdinalIgnoreCase))
        {
            logger.LogWarning($"SSH key download attempt with wrong identity hash. Expected: {actualHash}, Got: {hash}");
            return (403, "text/plain", Encoding.UTF8.GetBytes("Identity verification failed - this is not the selected vehicle"), false);
        }

        if (!File.Exists(sshKeyPath))
            return (404, "text/plain", Encoding.UTF8.GetBytes("SSH private key not available."), false);

        var keyBytes = File.ReadAllBytes(sshKeyPath);
        if (!keepPrivateKey)
        {
            File.Delete(sshKeyPath);
            logger.LogInformation("SSH private key downloaded and deleted for security.");
            return (200, "application/octet-stream", keyBytes, true);
        }
        logger.LogWarning("SSH private key downloaded but retained as per configuration.");
        return (200, "application/octet-stream", keyBytes, false);
    }

    static string StatusText(int code) => code switch
    {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "OK",
    };

    // HTTP listener (curl, LAN scripts)
    var httpListener = new HttpListener();
    httpListener.Prefixes.Add("http://+:8080/");
    httpListener.Start();

    // HTTPS listener (browser fetch). HttpListener on .NET / Linux doesn't
    // expose ListenerCertificate, so we hand-roll a TCP+SslStream loop and
    // serialize a minimal HTTP/1.1 response ourselves.
    var tcpListener = new TcpListener(IPAddress.Any, 8443);
    tcpListener.Start();

    async Task WriteHttpResponseAsync(Stream stream, int status, string contentType, byte[] body)
    {
        var sb = new StringBuilder();
        sb.Append("HTTP/1.1 ").Append(status).Append(' ').Append(StatusText(status)).Append("\r\n");
        sb.Append("Access-Control-Allow-Origin: *\r\n");
        sb.Append("Access-Control-Allow-Methods: GET, OPTIONS\r\n");
        sb.Append("Access-Control-Allow-Headers: Content-Type\r\n");
        if (status == 200 && body.Length > 0)
            sb.Append("Content-Disposition: attachment; filename=\"vehicle-ssh-key.der\"\r\n");
        if (contentType.Length > 0)
            sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
        sb.Append("Content-Length: ").Append(body.Length).Append("\r\n");
        sb.Append("Connection: close\r\n\r\n");
        var headerBytes = Encoding.ASCII.GetBytes(sb.ToString());
        await stream.WriteAsync(headerBytes);
        if (body.Length > 0)
            await stream.WriteAsync(body);
        await stream.FlushAsync();
    }

    _ = Task.Run(async () =>
    {
        while (httpListener.IsListening)
        {
            try
            {
                var ctx = await httpListener.GetContextAsync();
                try
                {
                    var (status, contentType, body, deleted) = DecideSshKeyResponse(
                        ctx.Request.HttpMethod ?? "GET",
                        ctx.Request.Url?.PathAndQuery ?? "",
                        sshKeyPath, carIdentityKey, keepPrivateKey, logger);

                    var resp = ctx.Response;
                    resp.Headers.Add("Access-Control-Allow-Origin", "*");
                    resp.Headers.Add("Access-Control-Allow-Methods", "GET, OPTIONS");
                    resp.Headers.Add("Access-Control-Allow-Headers", "Content-Type");
                    resp.StatusCode = status;
                    if (contentType.Length > 0) resp.ContentType = contentType;
                    if (status == 200 && body.Length > 0)
                        resp.Headers.Add("Content-Disposition", "attachment; filename=\"vehicle-ssh-key.der\"");
                    if (body.Length > 0)
                    {
                        resp.ContentLength64 = body.Length;
                        await resp.OutputStream.WriteAsync(body);
                    }
                    resp.Close();

                    if (deleted)
                    {
                        logger.LogInformation("SSH key download server stopped - key no longer available.");
                        httpListener.Stop();
                    }
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Error in HTTP listener");
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error accepting HTTP connection");
            }
        }
    });

    _ = Task.Run(async () =>
    {
        while (true)
        {
            TcpClient? client = null;
            SslStream? ssl = null;
            try
            {
                client = await tcpListener.AcceptTcpClientAsync();
                ssl = new SslStream(client.GetStream(), leaveInnerStreamOpen: false);
                await ssl.AuthenticateAsServerAsync(tlsCert, clientCertificateRequired: false, checkCertificateRevocation: false);

                // Minimal HTTP/1.1 request parser: read headers until CRLFCRLF.
                // Don't parse body — we don't accept one. Cap at 8 KiB to avoid
                // a malicious client streaming forever.
                var buf = new byte[8192];
                var headerBuf = new System.IO.MemoryStream();
                int headerEnd = -1;
                while (headerEnd < 0)
                {
                    var read = await ssl.ReadAsync(buf, 0, buf.Length);
                    if (read <= 0) break;
                    headerBuf.Write(buf, 0, read);
                    var span = headerBuf.GetBuffer().AsSpan(0, (int)headerBuf.Length);
                    for (int i = 3; i < span.Length; i++)
                    {
                        if (span[i - 3] == (byte)'\r' && span[i - 2] == (byte)'\n' &&
                            span[i - 1] == (byte)'\r' && span[i] == (byte)'\n')
                        {
                            headerEnd = i + 1;
                            break;
                        }
                    }
                    if (headerBuf.Length >= buf.Length && headerEnd < 0)
                        break; // oversize; bail
                }

                if (headerEnd < 0) { ssl.Close(); client.Close(); continue; }

                var headers = Encoding.ASCII.GetString(headerBuf.GetBuffer(), 0, headerEnd);
                var firstLineEnd = headers.IndexOf("\r\n", StringComparison.Ordinal);
                var firstLine = firstLineEnd < 0 ? headers : headers[..firstLineEnd];
                var parts = firstLine.Split(' ');
                var method = parts.Length > 0 ? parts[0] : "GET";
                var target = parts.Length > 1 ? parts[1] : "/";

                var (status, contentType, body, deleted) = DecideSshKeyResponse(
                    method, target, sshKeyPath, carIdentityKey, keepPrivateKey, logger);
                await WriteHttpResponseAsync(ssl, status, contentType, body);

                ssl.Close();
                client.Close();

                if (deleted)
                {
                    logger.LogInformation("HTTPS SSH key server stopped - key no longer available.");
                    tcpListener.Stop();
                    return;
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error in HTTPS listener");
                ssl?.Close();
                client?.Close();
            }
        }
    });

    logger.LogInformation("SSH key download server started on http://+:8080/ and https://+:8443/");
}
else
{
    logger.LogInformation("SSH key already downloaded - listeners not started");
}

// Initialize telemetry
var telemetryService = serviceProvider.GetRequiredService<TelemetryService>();
await telemetryService.ConnectToServer();

// Application loop
await Task.Run(async () =>
{
    while (true)
    {
        await Task.WhenAll(telemetryService.Tick(), Task.Delay(100));
    }
});

static void GenerateSshKeyPair(string privateKeyPath, string publicKeyPath)
{
    using var rsa = RSA.Create(2048);
    var privatePkcs8 = rsa.ExportPkcs8PrivateKey(); // → PKCS#8 Binary (DER)
    var publicSpki = rsa.ExportSubjectPublicKeyInfo(); // → SPKI Binary (DER)
    
    File.WriteAllBytes(privateKeyPath, privatePkcs8);
    File.WriteAllBytes(publicKeyPath, publicSpki);
}

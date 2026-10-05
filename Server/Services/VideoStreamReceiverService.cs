using System.Diagnostics;
using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Extensions.Options;
using LteCar.Server.Data;
using Microsoft.EntityFrameworkCore;
using LteCar.Shared.Video;
using LteCar.Server.Configuration;

namespace LteCar.Server;

public class VideoStreamReceiverService
{
    private readonly ConcurrentDictionary<long, Process> _activeStreamProxies = new();
    private readonly IServiceProvider _serviceProvider;

    public VideoStreamReceiverService(
        ILogger<VideoStreamReceiverService> logger,
        IOptions<JanusConfiguration> janusConfig,
        IServiceProvider serviceProvider)
    {
        Logger = logger;
        JanusConfig = janusConfig;
        _serviceProvider = serviceProvider;
    }

    public ILogger<VideoStreamReceiverService> Logger { get; }
    public IOptions<JanusConfiguration> JanusConfig { get; }

    public async Task<VideoSettings> StartStreamAsync(int streamId)
    {
        var ctx = _serviceProvider.CreateScope().ServiceProvider
            .GetRequiredService<LteCarContext>();
        var stream = await ctx
            .CarVideoStreams
            .Include(s => s.Car)
            .FirstOrDefaultAsync(s => s.Id == streamId);
        // if (stream != null && _activeStreamProxies.ContainsKey(streamId))
        // {
        //     Logger.LogWarning($"Stream with ID {streamId} is already active");
        //     return new VideoSettings()
        //     {
        //         Protocol = stream.Protocol,
        //         TargetPort = stream.Port,
        //         BitrateKbps = stream.BitrateKbps,
        //         Brightness = stream.Brightness,
        //         Framerate = stream.Framerate,
        //         Width = stream.Width,
        //         Height = stream.Height,
        //         JanusServer = JanusConfig.Value.HostName,
        //     };
        // }

        if (stream == null)
        {
            Logger.LogError($"Stream with ID {streamId} not found in database");
            throw new InvalidOperationException($"Stream with ID {streamId} not found");
        }
        if (stream.IsActive)
        {
            Logger.LogInformation("Stream '{StreamId}' is already active, recreating Janus mountpoint", stream.StreamId);
        }
        var protocol = stream.Protocol;
        var port = (stream.Port > 0 && IsPortAvailable(stream.Port, stream.Protocol)) ? stream.Port : FindFreePort(stream.Protocol);
        if (port == 0)
        {
            Logger.LogError($"No free port available for {protocol} stream");
            throw new InvalidOperationException("No free port available");
        }
        if (port != stream.Port)
        {
            Logger.LogInformation($"Updating stream '{stream.StreamId}' port from {stream.Port} to {port}");
            stream.Port = port;
        }
        if (stream.JanusPort == null)
        {
            var janusPort = FindFreePort(StreamProtocol.UDP);
            Logger.LogInformation($"Assigning Janus port {janusPort} to stream '{stream.StreamId}'");
            stream.JanusPort = janusPort;
        }

        await ctx.SaveChangesAsync();
        Logger.LogInformation($"Starting {protocol} stream '{stream.StreamId}' on port {port}");

        await OpenJanusEndpointAsync(stream);
        if (protocol == StreamProtocol.TCP && ! _activeStreamProxies.ContainsKey(streamId)) {
            await OpenTcpRelayProcessAsync(stream);
            port = stream.Port;
        }
        if (protocol == StreamProtocol.UDP)
        {
            port = stream.JanusPort.Value;
        }
        var res = new VideoSettings()
        {
            Protocol = protocol,
            TargetPort = port,
            Bitrate = stream.Bitrate,
            Brightness = stream.Brightness,
            Gain = stream.Gain,
            Shutter = stream.Shutter,
            Contrast = stream.Contrast,
            EV = stream.EV,
            Exposure = stream.Exposure,
            Framerate = stream.Framerate,
            Width = stream.Width,
            Height = stream.Height,
            JanusServer = JanusConfig.Value.HostName,
        };
        stream.IsActive = true;
        await ctx.SaveChangesAsync();
        return res;
    }

    private async Task OpenTcpRelayProcessAsync(CarVideoStream stream)
    {
        Logger.LogInformation($"Starting TCP relay for stream '{stream.StreamId}' on port {stream.Port}");
        var isDebug = Logger.IsEnabled(LogLevel.Debug);
        var janusHost = JanusConfig.Value.HostName;
        if (string.IsNullOrEmpty(janusHost)) janusHost = "localhost";
        var ffmpegArgs = $"{(isDebug ? "" : "-hide_banner -loglevel warning ")} -nostdin -i tcp://0.0.0.0:{stream.Port}?listen -reconnect 1 -c:v copy -f rtp rtp://{janusHost}:{stream.JanusPort!}";
        Logger.LogDebug($"FFmpeg args: {ffmpegArgs}");
        var startInfo = new ProcessStartInfo("ffmpeg", ffmpegArgs)
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
        };

        var process = new Process { StartInfo = startInfo };
        
        process.OutputDataReceived += (obj, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
                Logger.LogDebug($"FFmpeg TCP:{stream.Port} - {e.Data}");
        };
        
        process.ErrorDataReceived += (obj, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
                Logger.LogDebug($"FFmpeg TCP:{stream.Port} Error - {e.Data}");
        };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        _activeStreamProxies[stream.Id] = process;
    }

    /// <summary>
    /// Opens a new endpoint in Janus for receiving the stream via Janus HTTP API
    /// The Janus stream is always UDP, RTP 
    /// </summary>
    private async Task OpenJanusEndpointAsync(CarVideoStream stream)
    {
        var janusPort = stream.JanusPort ?? FindFreePort(StreamProtocol.UDP);
        stream.JanusPort = janusPort;
        try
        {
            var janusHost = JanusConfig.Value.HostName;
            if (string.IsNullOrEmpty(janusHost)) janusHost = "localhost";
            var janusBase = new UriBuilder("http", janusHost, 8088).Uri;

            using var client = new HttpClient();
            client.BaseAddress = janusBase;

            // 1) Create session
            var transaction = Guid.NewGuid().ToString("N");
            var session = await client.PostJsonAsync<JanusRequestBase, JanusCreateTransactionResponse>("janus", new JanusRequestBase() { 
                Janus = "create", 
                Transaction = transaction
            }, Logger, $"Creating Janus session for stream '{stream.StreamId}': ");
            var sessionId = session!.Data.Id;

            // 2) Attach streaming plugin
            var pluginSession = await client.PostJsonAsync<JanusAttachPluginRequest, JanusAttachPluginResponse>($"janus/{sessionId}", new JanusAttachPluginRequest() { 
                Janus = "attach", 
                Transaction = transaction,
                Plugin = "janus.plugin.streaming"
            }, Logger, $"Attaching streaming plugin for stream '{stream.StreamId}': ");
            var handleId = pluginSession!.Data.Id;

            // If the DB had a JanusPort configured, ask Janus whether it already knows a stream
            // bound to that port by issuing a "list" request to the streaming plugin.
            try
            {
                var listResponse = await client.PostJsonAsync<JanusMessageRequest<JanusMessageBody>, JanusPluginMessageResponse<JanusPluginMessageListResponseBody>>(
                    $"janus/{sessionId}/{handleId}",
                    new JanusMessageRequest<JanusMessageBody>()
                    {
                        Janus = "message",
                        Transaction = transaction,
                        Body = new JanusMessageBody()
                        {
                            Request = "list"
                        }
                    },
                    Logger,
                    $"Checking existing streams for port {stream.JanusPort.Value}: ");

                var existingStreams = listResponse?.Body?.Streams;
                if (existingStreams != null && existingStreams.Count > 0)
                {
                    // If Janus already has a mountpoint with the same numeric Id as our DB Id
                    // (e.g. leftover from a previous server run, or a default sample), destroy it
                    // so we can recreate it cleanly bound to the current session/handle.
                    var stale = existingStreams.FirstOrDefault(s => s.Id == (uint)stream.Id);
                    if (stale != null)
                    {
                        Logger.LogInformation(
                            $"Janus has stale mountpoint with id {stale.Id} (description='{stale.Description}'); destroying it before creating a new one for stream '{stream.StreamId}'");
                        await client.PostJsonAsync<JanusMessageRequest<JanusMountpointActionBody>, JanusPluginMessageResponse<object>>(
                            $"janus/{sessionId}/{handleId}",
                            new JanusMessageRequest<JanusMountpointActionBody>()
                            {
                                Janus = "message",
                                Transaction = transaction,
                                Body = new JanusMountpointActionBody()
                                {
                                    Request = "destroy",
                                    Id = stale.Id
                                }
                            },
                            Logger,
                            $"Destroying stale Janus mountpoint {stale.Id} for stream '{stream.StreamId}': ");
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.LogWarning(ex, $"Failed to query Janus for existing streams while checking port {stream.JanusPort.Value}");
            }

            // 3) Create RTP stream entry
            var body = new JanusCreateStreamRequestBody()
            {
                Request = "create",
                Type = "rtp",
                Id = (uint)stream.Id,
                Description = $"{stream.Car?.Name ?? stream.CarId.ToString()}-{stream.Name ?? stream.StreamId}",
                Audio = false,
                Video = true,
                VideoPort = janusPort
            };
            stream.JanusId = $"{stream.Car?.Name ?? stream.CarId.ToString()}-{stream.Name ?? stream.StreamId}";
            var createResponse = await client.PostJsonAsync<JanusMessageRequest<JanusCreateStreamRequestBody>, JanusPluginMessageResponse<object>>(
                $"janus/{sessionId}/{handleId}",
                new JanusMessageRequest<JanusCreateStreamRequestBody>()
                {
                    Janus = "message",
                    Transaction = transaction,
                    Body = body
                }, 
                Logger, 
                $"Creating Janus RTP endpoint for stream '{stream.StreamId}': ");

            Logger.LogInformation($"Created Janus RTP endpoint for stream '{stream.StreamId}' on UDP port {janusPort} (session {sessionId}, handle {handleId})");
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, $"Failed to create Janus endpoint for stream {stream.StreamId}");
            throw;
        }
    }

    public int FindFreePort(StreamProtocol protocol)
    {
        var (startPort, endPort) = (JanusConfig.Value.PortRangeStart, JanusConfig.Value.PortRangeEnd);
        var ctx = _serviceProvider.CreateScope().ServiceProvider
            .GetRequiredService<LteCarContext>();
        var takenPorts = ctx.CarVideoStreams
            .Where(s => s.IsActive)
            .Select(e => new { e.JanusPort, e.Port })
            .ToList()
            .SelectMany(e => new[] { e.JanusPort, e.Port })
            .Where(p => p.HasValue)
            .Select(p => p!.Value)
            .Distinct()
            .ToHashSet();
        for (int port = startPort; port <= endPort; port++)
        {
            if (!takenPorts.Contains(port))
            {
                if (!IsPortAvailable(port, protocol))
                {
                    Logger.LogWarning($"Port {port} is not available even though its within the assigned port range!");
                    continue;
                }
                return port;
            }
        }
        throw new InvalidOperationException("No free ports available in the configured port range.");
    }

    private bool IsPortAvailable(int port, StreamProtocol protocol)
    {
        try
        {
            if (protocol == StreamProtocol.TCP)
            {
                using var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Any, port);
                listener.Start();
                listener.Stop();
                return true;
            }
            else
            {
                using var client = new System.Net.Sockets.UdpClient(port);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    // private static bool JsonListContainsPort(JsonElement listElem, int port)
    // {
    //     if (listElem.ValueKind != JsonValueKind.Array)
    //         return false;

    //     foreach (var item in listElem.EnumerateArray())
    //     {
    //         if (TryGetPortFromElement(item, out var found) && found == port)
    //             return true;

    //         // As a fallback, scan numeric properties for the port value
    //         if (item.ValueKind == JsonValueKind.Object)
    //         {
    //             foreach (var prop in item.EnumerateObject())
    //             {
    //                 if (prop.Value.ValueKind == JsonValueKind.Number && prop.Value.TryGetInt32(out var v) && v == port)
    //                     return true;
    //             }
    //         }
    //     }

    //     return false;
    // }

    private static bool TryGetPortFromElement(JsonElement el, out int port)
    {
        // Common Janus streaming fields
        if (el.TryGetProperty("rtp_port", out var rtp) && rtp.ValueKind == JsonValueKind.Number && rtp.TryGetInt32(out port))
            return true;
        if (el.TryGetProperty("port", out var p) && p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out port))
            return true;
        if (el.TryGetProperty("audioport", out var ap) && ap.ValueKind == JsonValueKind.Number && ap.TryGetInt32(out port))
            return true;
        if (el.TryGetProperty("videoport", out var vp) && vp.ValueKind == JsonValueKind.Number && vp.TryGetInt32(out port))
            return true;

        // Recurse into nested objects
        if (el.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in el.EnumerateObject())
            {
                if (prop.Value.ValueKind == JsonValueKind.Object)
                {
                    if (TryGetPortFromElement(prop.Value, out port))
                        return true;
                }
            }
        }

        port = 0;
        return false;
    }

    // private Process StartUdpStream(int port)
    // {
    //     // Für UDP direkt von Janus - hier könnten wir einen einfachen UDP Relay starten
    //     // oder direkt Janus mit dem spezifischen Port konfigurieren
        
    //     // Use ffmpeg to listen on a UDP port and forward to local RTP ingest.
    //     var ffmpegArgs = $"-hide_banner -loglevel warning -nostats -nostdin -i udp://0.0.0.0:{port} -c:v copy -f rtp rtp://127.0.0.1:10000";

    //     var startInfo = new ProcessStartInfo("ffmpeg", ffmpegArgs)
    //     {
    //         CreateNoWindow = true,
    //         UseShellExecute = false,
    //         RedirectStandardError = true,
    //         RedirectStandardOutput = true,
    //     };

    //     var process = new Process { StartInfo = startInfo };

    //     process.OutputDataReceived += (obj, e) =>
    //     {
    //         if (string.IsNullOrEmpty(e.Data)) return;
    //         Logger.LogDebug($"FFmpeg UDP:{port} - {e.Data}");
    //     };

    //     process.ErrorDataReceived += (obj, e) =>
    //     {
    //         if (string.IsNullOrEmpty(e.Data)) return;
    //         Logger.LogWarning($"FFmpeg UDP:{port} Error - {e.Data}");
    //     };

    //     process.Exited += (obj, e) =>
    //     {
    //         try
    //         {
    //             Logger.LogWarning($"FFmpeg UDP:{port} exited with code {process.ExitCode}");
    //         }
    //         catch { }
    //     };

    //     process.Start();
    //     process.BeginOutputReadLine();
    //     process.BeginErrorReadLine();

    //     return process;
    // }

    public async Task StopStream(int streamId)
    {
        try
        {
            Logger.LogInformation($"Stopping stream '{streamId}'");
            var ctx = _serviceProvider.CreateScope().ServiceProvider
                .GetRequiredService<LteCarContext>();
            var stream = await ctx
                .CarVideoStreams
                .FirstOrDefaultAsync(s => s.Id == streamId);
            if (stream == null)
            {
                Logger.LogError($"Stream with ID {streamId} not found in database");
                return;
            }
            stream.IsActive = false;
            await ctx.SaveChangesAsync();

            // Tear down the Janus mountpoint so the next ActivateStream can create it fresh.
            // We do this on a brand-new session/handle: the original one is gone after a
            // server restart, and even when the server is still alive the streaming plugin
            // accepts "destroy" on any handle attached to the same plugin.
            try
            {
                await DestroyJanusMountpointAsync(streamId);
            }
            catch (Exception ex)
            {
                Logger.LogWarning(ex, $"Failed to destroy Janus mountpoint for stream '{streamId}'; it may need to be cleared manually");
            }

            if (_activeStreamProxies.TryRemove(streamId, out var streamInfo))
            {
                Logger.LogDebug($"Found active process for stream '{streamId}', stopping it.");
                try
                {
                    streamInfo.Kill();
                    streamInfo.Dispose();
                    Logger.LogInformation($"Stopped stream proxy for '{streamId}'");
                }
                catch (Exception ex)
                {
                    Logger.LogError(ex, $"Error stopping stream '{streamId}'");
                }            
            }
            Logger.LogInformation($"Stopped stream '{streamId}' successfully");
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, $"Error stopping stream '{streamId}'");
        }
    }

    public async Task<bool> StopStreamsByCar(string carId)
    {
        var carStreams = _serviceProvider.CreateScope().ServiceProvider
            .GetRequiredService<LteCarContext>()
            .CarVideoStreams
            .Where(s => s.Car.CarIdentityKey == carId && s.IsActive)
            .AsNoTracking()
            .ToList();
        var stoppedCount = 0;

        foreach (var stream in carStreams)
        {
            await StopStream(stream.Id);
            stoppedCount++;
        }
        Logger.LogInformation($"Stopped {stoppedCount} streams for car '{carId}'");
        return stoppedCount > 0;
    }

    /// <summary>
    /// Destroys the Janus streaming-plugin mountpoint whose numeric id equals
    /// <paramref name="mountpointDbId"/>. Uses a fresh session/handle, which is the only
    /// safe option after a server restart (the original handle is gone) and is accepted
    /// by the streaming plugin regardless of which handle originally created the mountpoint.
    /// Tolerates "no such mountpoint" errors.
    /// </summary>
    public async Task DestroyJanusMountpointAsync(int mountpointDbId)
    {
        var janusHost = JanusConfig.Value.HostName;
        if (string.IsNullOrEmpty(janusHost)) janusHost = "localhost";
        var janusBase = new UriBuilder("http", janusHost, 8088).Uri;

        using var client = new HttpClient { BaseAddress = janusBase };
        var transaction = Guid.NewGuid().ToString("N");

        var session = await client.PostJsonAsync<JanusRequestBase, JanusCreateTransactionResponse>(
            "janus", new JanusRequestBase() { Janus = "create", Transaction = transaction },
            Logger, $"Creating Janus session to destroy mountpoint {mountpointDbId}: ");
        var sessionId = session!.Data.Id;

        try
        {
            var pluginSession = await client.PostJsonAsync<JanusAttachPluginRequest, JanusAttachPluginResponse>(
                $"janus/{sessionId}", new JanusAttachPluginRequest()
                {
                    Janus = "attach",
                    Transaction = transaction,
                    Plugin = "janus.plugin.streaming"
                },
                Logger, $"Attaching streaming plugin to destroy mountpoint {mountpointDbId}: ");
            var handleId = pluginSession!.Data.Id;

            await client.PostJsonAsync<JanusMessageRequest<JanusMountpointActionBody>, JanusPluginMessageResponse<object>>(
                $"janus/{sessionId}/{handleId}",
                new JanusMessageRequest<JanusMountpointActionBody>()
                {
                    Janus = "message",
                    Transaction = transaction,
                    Body = new JanusMountpointActionBody()
                    {
                        Request = "destroy",
                        Id = (uint)mountpointDbId
                    }
                },
                Logger, $"Destroying Janus mountpoint {mountpointDbId}: ");

            Logger.LogInformation($"Destroyed Janus mountpoint {mountpointDbId} (session {sessionId}, handle {handleId})");
        }
        finally
        {
            // Best-effort: destroy the throwaway session. Failure here is harmless.
            try
            {
                await client.PostAsync(
                    $"janus/{sessionId}",
                    new StringContent(
                        System.Text.Json.JsonSerializer.Serialize(new { janus = "destroy", transaction }),
                        System.Text.Encoding.UTF8,
                        "application/json"),
                    new CancellationTokenSource(TimeSpan.FromSeconds(2)).Token);
            }
            catch { /* ignore */ }
        }
    }

}

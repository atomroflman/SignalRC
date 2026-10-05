using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Text;
using LteCar.Shared.Channels;
using LteCar.Shared;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using LteCar.Shared.Video;

namespace LteCar.Onboard;

public class MediaMtxConfiguration
{
    public string Host { get; set; } = string.Empty;
    public int VideoPort { get; set; } = 10001;
    public int AudioPort { get; set; } = 11001;
    public string StreamName { get; set; } = "rpi0";
    public int Width { get; set; } = 1024;
    public int Height { get; set; } = 768;
    public int Framerate { get; set; } = 22;
    public int Bitrate { get; set; } = 1000000;
    public string CameraLib { get; set; } = "libcamera-vid";
}

public interface IMediaMtxConfigurator
{
    // Task<string> GenerateConfigurationAsync(MediaMtxConfiguration config);
    Task GenerateFromChannelMapAsync(ChannelMap channelMap);
    // Task UpdateServerAddressAsync(string serverHost, int videoPort, int audioPort);
    // Task StartProcessAsync();
    // Task StopAsync();
    // Task RestartAsync();
    // MediaMtxConfiguration CurrentConfiguration { get; }
}

public class MediaMtxConfigurator : IMediaMtxConfigurator
{
    private readonly ILogger<MediaMtxConfigurator> _logger;
    private readonly IConfiguration _configuration;
    private readonly string _configPath;
    private readonly string _backupPath;
    private readonly string _mediamtxBinary;

    public MediaMtxConfigurator(
        ILogger<MediaMtxConfigurator> logger,
        IConfiguration configuration)
    {
        _logger = logger;
        _configuration = configuration;
        _configPath = ResolveMediaMtxBinary(logger) + ".yml";
        _backupPath = Path.GetFullPath("./Extern/mediamtx.yml.backup");

        _mediamtxBinary = ResolveMediaMtxBinary(_logger) ?? string.Empty;
        if (string.IsNullOrEmpty(_mediamtxBinary))
        {
            _logger.LogError("mediamtx binary not found. Install it via your package manager (apt/pacman) or place it at {Path}.",
                Path.GetFullPath("./Extern/mediamtx"));
        }
    }

    private string? ResolveMediaMtxBinary(ILogger logger)
    {
        var configPath = _configuration.GetSection("MediaMtxPath").Get<string>() ?? "/";
        var configExePath = Path.Combine(configPath, "mediamtx");
        if (File.Exists(configExePath))
            return configExePath;

        var pathDirs = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
        foreach (var dir in pathDirs)
        {
            var candidate = Path.Combine(dir, "mediamtx");
            if (File.Exists(candidate))
            {
                logger.LogInformation("Using mediamtx from PATH: {Path}", candidate);
                return candidate;
            }
        }

        var vendored = Path.GetFullPath("./Extern/mediamtx");
        if (File.Exists(vendored))
        {
            logger.LogInformation("Using vendored mediamtx at {Path}", vendored);
            return vendored;
        }

        return null;
    }

//     public async Task<string> GenerateConfigurationAsync(MediaMtxConfiguration config)
//     {
//         var template = await File.ReadAllTextAsync(_configPath);
        
//         template = ReplaceOrAddLine(template, "webrtcLocalUDPAddress", $"webrtcLocalUDPAddress: :{config.AudioPort + 100}");
//         template = ReplaceOrAddLine(template, "rtpAddress", $"rtpAddress: :{config.VideoPort}");
//         template = ReplaceOrAddLine(template, "rtcpAddress", $"rtcpAddress: :{config.VideoPort + 1}");
        
//         var rpiCameraSection = $@"
//   {config.StreamName}:
//     source: rpiCamera
//     runOnInit: ffmpeg -t 2147483647 -i rtsp://localhost:8554/{config.StreamName} -c copy -f rtp rtp://{config.Host}:{config.VideoPort}?pkt_size=1300
//     runOnInitRestart: yes
//     rpiCameraCamID: 0
//     rpiCameraWidth: {config.Width}
//     rpiCameraHeight: {config.Height}
//     rpiCameraFPS: {config.Framerate}
//     rpiCameraTextOverlay: '%Y-%m-%d %H:%M:%S - {config.StreamName}'
//     rpiCameraBrightness: 0.3
//     rpiCameraContrast: 1
//     rpiCameraExposure: normal
//     rpiCameraEV: 0
//     rpiCameraGain: 0
//     rpiCameraBitrate: {config.Bitrate}
//     rpiCameraIDRPeriod: 60";

//         template = UpdateOrAddPathSection(template, config.StreamName, rpiCameraSection);
        
//         _currentConfig = config;

//         return template;
//     }

    public async Task GenerateFromChannelMapAsync(ChannelMap channelMap)
    {
        // var template = await File.ReadAllTextAsync(_configPath);
        var generatedPaths = new StringBuilder();
        var host = _configuration.GetSection("ServerName").Get<string>();
        var sourceHost = string.IsNullOrWhiteSpace(host) ? "localhost" : host;

        generatedPaths.AppendLine("paths:");
        foreach (var stream in channelMap.VideoStreams.Where(s => s.Value.Enabled))
        {
            var cameraDevice = string.IsNullOrWhiteSpace(stream.Value.CameraDevice) ? "/dev/video0" : stream.Value.CameraDevice;

            generatedPaths.AppendLine($"  {stream.Key}:");
            generatedPaths.AppendLine($"    source: rpiCamera");
            generatedPaths.AppendLine($"    runOnInitRestart: yes");
            // TODO: Make it configurable in gui (advanced options)
            generatedPaths.AppendLine($"    rpiCameraDenoise: \"cdn_hq\"");
            generatedPaths.AppendLine($"    runOnInit: ffmpeg -t 2147483647 -i rtsp://localhost:8554/{stream.Key} -c copy -f rtp rtp://{sourceHost}:{stream.Value.Port}?pkt_size=1300");
            //generatedPaths.AppendLine($"    runOnInit: ffmpeg -f v4l2 -framerate {stream.Value.Framerate} -video_size {stream.Value.Width}x{stream.Value.Height} -i rtsp://localhost:8554/{stream.Key} -c:v libx264 -preset veryfast -tune zerolatency -b:v {stream.Value.Bitrate} -f rtp rtp://{sourceHost}:{stream.Value.Port}?pkt_size=1300");
            
            foreach (var prop in stream.Value.GetType().GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance)
                .Select(e => new {
                    e, 
                    mtxName = e.GetCustomAttributes(true).OfType<MediaMtxNameAttribute>().FirstOrDefault(),
                    value = e.GetValue(stream.Value)
                })
                .Where(e => e.mtxName != null && e.value != null))
            {
                generatedPaths.AppendLine($"    {prop.mtxName!.Name}: {prop.value}");
            }

        }

        generatedPaths.AppendLine("  all_others:");

        // template = ReplacePathsSection(template, generatedPaths.ToString().TrimEnd());

        await File.WriteAllTextAsync(_configPath, generatedPaths.ToString());
    }

    private string ReplaceOrAddLine(string content, string key, string newValue)
    {
        var lines = content.Split('\n').ToList();
        var keyPattern = $"^{key}:";
        
        for (int i = 0; i < lines.Count; i++)
        {
            if (Regex.IsMatch(lines[i], keyPattern))
            {
                lines[i] = newValue;
                return string.Join('\n', lines);
            }
        }
        
        var insertIndex = FindInsertIndexForKey(lines, key);
        lines.Insert(insertIndex, newValue);
        return string.Join('\n', lines);
    }

    private int FindInsertIndexForKey(List<string> lines, string key)
    {
        for (int i = 0; i < lines.Count; i++)
        {
            if (lines[i].StartsWith(key.Split(':')[0] + ":"))
            {
                return i;
            }
        }
        return lines.Count;
    }

    private string UpdateOrAddPathSection(string content, string pathName, string newSection)
    {
        var lines = content.Split('\n').ToList();
        
        var pathPattern = $"^\\s*{pathName}\\s*:";
        int startIndex = -1;
        int endIndex = lines.Count;
        
        for (int i = 0; i < lines.Count; i++)
        {
            if (Regex.IsMatch(lines[i], pathPattern))
            {
                startIndex = i;
                for (int j = i + 1; j < lines.Count; j++)
                {
                    if (lines[j].Trim().StartsWith("all_others:"))
                    {
                        endIndex = j;
                        break;
                    }
                }
                break;
            }
        }
        
        if (startIndex >= 0)
        {
            lines.RemoveRange(startIndex, endIndex - startIndex);
            lines.Insert(startIndex, newSection);
        }
        else
        {
            var pathsIndex = lines.FindIndex(l => l.TrimStart().StartsWith("paths:"));
            if (pathsIndex >= 0)
            {
                lines.Insert(pathsIndex + 1, newSection);
            }
        }
        
        return string.Join('\n', lines);
    }
}

using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Text;
using SignalRC.Shared.Channels;
using SignalRC.Shared;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Video;

namespace SignalRC.Onboard;

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
    private readonly ServerCarConfigurationService _carConfiguration;
    private readonly string _configPath;
    private readonly string _backupPath;
    private readonly string _mediamtxBinary;

    public MediaMtxConfigurator(
        ILogger<MediaMtxConfigurator> logger,
        IConfiguration configuration,
        ServerCarConfigurationService carConfiguration)
    {
        _logger = logger;
        _configuration = configuration;
        _carConfiguration = carConfiguration;
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
        // The server names the Janus host it wants RTP on; without one, Janus sits behind ServerName.
        var host = _carConfiguration.Configuration?.JanusConfiguration?.JanusServerHost;
        if (string.IsNullOrWhiteSpace(host))
            host = _configuration.GetSection("ServerName").Get<string>();
        var sourceHost = string.IsNullOrWhiteSpace(host) ? "localhost" : host;

        generatedPaths.AppendLine("paths:");
        foreach (var stream in channelMap.VideoStreams.Where(s => s.Value.Enabled))
        {
            var cameraDevice = string.IsNullOrWhiteSpace(stream.Value.CameraDevice) ? "/dev/video0" : stream.Value.CameraDevice;

            generatedPaths.AppendLine($"  {stream.Key}:");
            // The rpiCamera source carries SPS/PPS only in the RTSP SDP, not in-band, and Janus' mountpoint
            // has no sprop-parameter-sets: dump_extra repeats them before every keyframe so a viewer can decode.
            var forwardToServer = $"ffmpeg{FfmpegLogArgs(stream.Value)} -t 2147483647 -i rtsp://localhost:8554/{stream.Key} -c copy -bsf:v dump_extra -f rtp rtp://{sourceHost}:{stream.Value.Port}?pkt_size=1300";

            if (IsV4l2Camera(stream.Value))
            {
                // A USB webcam has no native mediamtx source: ffmpeg encodes it and sends RTP straight
                // to the server, mediamtx only keeps the process alive.
                generatedPaths.AppendLine($"    runOnInit: {BuildV4l2Command(stream.Value, cameraDevice, $"rtp://{sourceHost}:{stream.Value.Port}?pkt_size=1300")}");
                generatedPaths.AppendLine($"    runOnInitRestart: yes");
                continue;
            }

            generatedPaths.AppendLine($"    source: rpiCamera");
            generatedPaths.AppendLine($"    runOnInitRestart: yes");
            // TODO: Make it configurable in gui (advanced options)
            generatedPaths.AppendLine($"    rpiCameraDenoise: \"cdn_hq\"");
            generatedPaths.AppendLine($"    runOnInit: {forwardToServer}");
            if (SensorMode(stream.Value) is { } sensorMode)
                generatedPaths.AppendLine($"    rpiCameraMode: \"{sensorMode}\"");

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

    private static readonly string[] V4l2Types = ["v4l2", "webcam", "usb"];

    /// <summary>ffmpeg -loglevel values, quietest first.</summary>
    private static readonly string[] FfmpegLogLevels = ["quiet", "panic", "fatal", "error", "warning", "info", "verbose", "debug"];
    private const string DefaultFfmpegLogLevel = "warning";

    private static readonly OptionSchema FfmpegLogLevelOption = new()
    {
        Name = "ffmpegLogLevel", Type = "string", Values = FfmpegLogLevels, DefaultJson = $"\"{DefaultFfmpegLogLevel}\"",
        Description = "How much ffmpeg writes to mediamtx.err (ffmpeg -loglevel). From \"info\" on it also prints the frame/fps progress line, about 17 MB a day - only for debugging.",
    };

    /// <summary>The stream options read in <see cref="BuildV4l2Command"/> and <see cref="FfmpegLogArgs"/>, for the options editor.</summary>
    public static IEnumerable<ChannelTypeSchema> OptionSchemas() => V4l2Types.Select(type => new ChannelTypeSchema
    {
        Kind = ChannelTypeSchema.Video,
        TypeName = type,
        Description = "USB webcam captured with ffmpeg (V4L2).",
        Options =
        [
            FfmpegLogLevelOption,
            new OptionSchema
            {
                Name = "inputFormat", Type = "string", Values = ["mjpeg", "yuyv422", "h264"],
                Description = "Capture format (ffmpeg -input_format). Many webcams reach higher resolutions and framerates only in MJPEG.",
            },
            new OptionSchema
            {
                Name = "hwEncoder", Type = "boolean", DefaultJson = "false",
                Description = "Encode with the SoC's H.264 block (h264_v4l2m2m) instead of libx264, which takes most of a Pi 3's CPU at 720p and above.",
            },
        ],
    }).Append(new ChannelTypeSchema
    {
        Kind = ChannelTypeSchema.Video,
        TypeName = "camera",
        Description = "Raspberry Pi camera; mediamtx captures, ffmpeg forwards the stream to the server.",
        Options =
        [
            FfmpegLogLevelOption,
            new OptionSchema
            {
                Name = "sensorMode", Type = "string",
                Description = "Sensor mode width:height[:bit-depth[:packing]], e.g. \"2304:1296:10:P\" (mediamtx rpiCameraMode). "
                    + "libcamera otherwise picks the mode closest to the output size, which may crop: on the Camera Module 3 (imx708) "
                    + "1536x864 only sees the centre 2/3 of the sensor, 2304:1296 scaled down keeps the full field of view.",
            },
        ],
    });

    private static readonly Regex SensorModePattern = new(@"^\d{2,5}:\d{2,5}(:\d{1,2}(:[PU])?)?$", RegexOptions.Compiled);

    /// <summary>The "sensorMode" option if it is a valid rpiCameraMode value; anything else is dropped with the line it would break.</summary>
    public static string? SensorMode(VideoStreamMapItem stream)
    {
        var mode = stream.Options.TryGetValue("sensorMode", out var raw) ? raw?.ToString()?.Trim() : null;
        return !string.IsNullOrEmpty(mode) && SensorModePattern.IsMatch(mode) ? mode : null;
    }

    /// <summary>
    /// " -hide_banner -loglevel X" plus " -nostats" below "info". An unknown value falls back to
    /// the default rather than reaching the command line, which mediamtx runs through a shell-like split.
    /// </summary>
    public static string FfmpegLogArgs(VideoStreamMapItem stream)
    {
        var level = stream.Options.TryGetValue("ffmpegLogLevel", out var raw) ? raw?.ToString()?.Trim().ToLowerInvariant() : null;
        var index = Array.IndexOf(FfmpegLogLevels, level ?? string.Empty);
        if (index < 0)
        {
            level = DefaultFfmpegLogLevel;
            index = Array.IndexOf(FfmpegLogLevels, level);
        }
        var quietStats = index < Array.IndexOf(FfmpegLogLevels, "info");
        return $" -hide_banner -loglevel {level}" + (quietStats ? " -nostats" : string.Empty);
    }

    /// <summary>
    /// The stream's <c>Type</c> picks the capture path: "v4l2"/"webcam"/"usb" is a plain V4L2 device
    /// (<c>CameraDevice</c>), anything else stays the Raspberry Pi camera (<c>RpiCamId</c>).
    /// </summary>
    private static bool IsV4l2Camera(VideoStreamMapItem stream) =>
        V4l2Types.Contains(stream.Type?.Trim(), StringComparer.OrdinalIgnoreCase);

    private static string BuildV4l2Command(VideoStreamMapItem stream, string cameraDevice, string target)
    {
        var inv = CultureInfo.InvariantCulture;
        var cmd = new StringBuilder("ffmpeg").Append(FfmpegLogArgs(stream)).Append(" -f v4l2");
        // Optional capture format, e.g. {"inputFormat":"mjpeg"}: many webcams only reach higher
        // resolutions/framerates in MJPEG.
        if (stream.Options.TryGetValue("inputFormat", out var inputFormat) && !string.IsNullOrWhiteSpace(inputFormat?.ToString()))
            cmd.Append($" -input_format {inputFormat}");
        if (stream.Framerate is { } fps)
            cmd.Append($" -framerate {fps}");
        if (stream.Width is { } w && stream.Height is { } h)
            cmd.Append($" -video_size {w}x{h}");
        cmd.Append($" -i {cameraDevice}");
        // Send the frames the camera delivers. The RTP muxer would otherwise pad up to -framerate with
        // duplicates, which the encoder then has to encode as well.
        cmd.Append(" -fps_mode passthrough");

        // Same value ranges as rpiCameraBrightness (-1..1, 0 = neutral) and rpiCameraContrast (1 = neutral).
        var brightness = stream.Brightness ?? 0f;
        var contrast = stream.Contrast ?? 1f;
        if (brightness != 0f || contrast != 1f)
            cmd.Append(string.Format(inv, " -vf eq=brightness={0}:contrast={1}", brightness, contrast));

        // {"hwEncoder":true}: the SoC's H.264 block (Raspberry Pi: /dev/video11) instead of libx264,
        // which takes most of a Pi 3's CPU at 720p and above.
        var hwEncoder = stream.Options.TryGetValue("hwEncoder", out var hw)
            && (hw is true || string.Equals(hw?.ToString(), "true", StringComparison.OrdinalIgnoreCase));
        cmd.Append(hwEncoder
            ? " -c:v h264_v4l2m2m -pix_fmt yuv420p"
            : " -c:v libx264 -pix_fmt yuv420p -preset ultrafast -tune zerolatency");
        if (stream.Bitrate is { } bitrate)
            cmd.Append($" -b:v {bitrate}");
        // Keyframe every second so viewers joining mid-stream get a picture quickly.
        if (stream.Framerate is { } gop)
            cmd.Append($" -g {gop}");
        // Janus needs SPS/PPS in-band; repeat them on every keyframe whatever the encoder does.
        if (hwEncoder)
            cmd.Append(" -bsf:v dump_extra");
        cmd.Append($" -f rtp {target}");
        return cmd.ToString();
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

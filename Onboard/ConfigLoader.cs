using System.Text.Json;
using SignalRC.Shared.Channels;

namespace SignalRC.Onboard;

public class ConfigLoader
{
    private readonly string _configDir;

    public string ConfigDir => _configDir;
    public string ChannelMapPath => Path.Combine(_configDir, "channelMap.json");
    public string AppSettingsPath => Path.Combine(_configDir, "appSettings.json");
    public string SshKeyPath => Path.Combine(_configDir, "ssh_key");
    public string SshPublicKeyPath => Path.Combine(_configDir, "ssh_key.pub");

    public ConfigLoader(string configDir)
    {
        _configDir = Path.GetFullPath(configDir);
    }

    public void EnsureConfigDirectory()
    {
        if (!Directory.Exists(_configDir))
        {
            Directory.CreateDirectory(_configDir);
            Console.WriteLine($"Created config directory: {_configDir}");
        }
    }

    public async Task<ChannelMap?> LoadConfigsAsync()
    {
        EnsureConfigDirectory();

        if (!File.Exists(ChannelMapPath))
        {
            Console.WriteLine($"channelMap.json not found in: {_configDir}");
            return null;
        }

        var json = await File.ReadAllTextAsync(ChannelMapPath);
        var channelMap = JsonSerializer.Deserialize<ChannelMap>(json, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
        });
        // ponytail: stamp first-load JSON so LWW has a baseline; Phase 2 moves this to SQLite.
        var now = DateTime.UtcNow;
        if (channelMap != null)
        {
            foreach (var c in channelMap.ControlChannels.Values) c.ModifiedAt ??= now;
            foreach (var t in channelMap.TelemetryChannels.Values) t.ModifiedAt ??= now;
            foreach (var v in channelMap.VideoStreams.Values) v.ModifiedAt ??= now;
        }

        return channelMap;
    }
}

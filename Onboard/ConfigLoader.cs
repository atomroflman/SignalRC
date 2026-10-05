using Spectre.Console;
using System.Text.Json;
using LteCar.Shared.Channels;

namespace LteCar.Onboard;

public class ConfigLoader
{
    private readonly string _defaultConfigDir;
    private string _configDir;
    private readonly string _configDirFile;

    public string ConfigDir => _configDir;
    public string ChannelMapPath => Path.Combine(_configDir, "channelMap.json");
    public string AppSettingsPath => Path.Combine(_configDir, "appSettings.json");
    public string SshKeyPath => Path.Combine(_configDir, "ssh_key");
    public string SshPublicKeyPath => Path.Combine(_configDir, "ssh_key.pub");

    public ConfigLoader(string defaultConfigDir, string? customConfigDir = null)
    {
        _defaultConfigDir = defaultConfigDir;
        _configDirFile = Path.Combine(defaultConfigDir, ".configdir");

        var savedConfigDir = LoadSavedConfigDir();
        _configDir = Path.GetFullPath(customConfigDir ?? savedConfigDir ?? FindConfigDir());

        if (customConfigDir != null && customConfigDir != savedConfigDir)
        {
            SaveConfigDir(_configDir);
        }
    }

    private string? LoadSavedConfigDir()
    {
        try
        {
            if (File.Exists(_configDirFile))
            {
                var saved = File.ReadAllText(_configDirFile).Trim();
                if (Directory.Exists(saved))
                {
                    AnsiConsole.MarkupLine($"[dim]Using saved config directory: {saved}[/]");
                    return saved;
                }
            }
        }
        catch { }
        return null;
    }

    public void SaveConfigDir(string path)
    {
        try
        {
            File.WriteAllText(_configDirFile, path);
            AnsiConsole.MarkupLine($"[green]Config directory saved: {path}[/]");
        }
        catch (Exception ex)
        {
            AnsiConsole.MarkupLine($"[yellow]Could not save config directory: {ex.Message}[/]");
        }
    }

    private string FindConfigDir()
    {
        if (Directory.Exists(_defaultConfigDir))
            return _defaultConfigDir;

        var parentBuilds = Path.Combine("..", "Builds");
        if (Directory.Exists(parentBuilds))
        {
            var dirs = Directory.GetDirectories(parentBuilds);
            if (dirs.Length > 0)
            {
                var mostRecent = dirs.OrderByDescending(d => Directory.GetCreationTime(d)).First();
                AnsiConsole.MarkupLine($"[yellow]No config directory found. Using most recent build: {mostRecent}[/]");
                return mostRecent;
            }
        }

        return _defaultConfigDir;
    }

    public void EnsureConfigDirectory()
    {
        if (!Directory.Exists(_configDir))
        {
            Directory.CreateDirectory(_configDir);
            AnsiConsole.MarkupLine($"[green]Created config directory: {_configDir}[/]");
        }
    }

    public async Task<ChannelMap?> LoadConfigsAsync()
    {
        EnsureConfigDirectory();

        if (!File.Exists(ChannelMapPath))
        {
            AnsiConsole.MarkupLine($"[red]channelMap.json not found in: {_configDir}[/]");
            
            var choice = AnsiConsole.Prompt(new SelectionPrompt<string>()
                .Title("What would you like to do?")
                .AddChoices(new[]
                {
                    "Create new channelMap using setup tool",
                    "Specify a different config directory",
                    "Use default channelMap from current directory",
                    "Exit"
                }));

            switch (choice)
            {
                case "Create new channelMap using setup tool":
                    AnsiConsole.MarkupLine("[yellow]Running setup tool...[/]");
                    Setup.VehicleSetupTool.Run();
                    break;
                case "Specify a different config directory":
                    var newPath = AnsiConsole.Ask<string>("Enter the config directory path:");
                    if (Directory.Exists(newPath))
                    {
                        SaveConfigDir(newPath);
                        _configDir = newPath;
                        return await LoadConfigsAsync();
                    }
                    else
                    {
                        AnsiConsole.MarkupLine($"[red]Directory does not exist: {newPath}[/]");
                        return await LoadConfigsAsync();
                    }
                case "Use default channelMap from current directory":
                    var defaultPath = Path.Combine(Directory.GetCurrentDirectory(), "channelMap.json");
                    if (File.Exists(defaultPath))
                    {
                        SaveConfigDir(Directory.GetCurrentDirectory());
                        _configDir = Directory.GetCurrentDirectory();
                        AnsiConsole.MarkupLine($"[green]Using default directory: {_configDir}[/]");
                        break;
                    }
                    AnsiConsole.MarkupLine($"[red]No channelMap.json in current directory either.[/]");
                    return await LoadConfigsAsync();
                case "Exit":
                    AnsiConsole.MarkupLine("[yellow]Exiting...[/]");
                    Environment.Exit(0);
                    break;
            }
        }

        ChannelMap? channelMap = null;
        if (File.Exists(ChannelMapPath))
        {
            var json = await File.ReadAllTextAsync(ChannelMapPath);
            channelMap = JsonSerializer.Deserialize<ChannelMap>(json, new JsonSerializerOptions
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
        }

        return channelMap;
    }
}

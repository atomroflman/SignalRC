using System.Diagnostics;
using System.Reflection;
using SignalRC.Onboard.Control;
using SignalRC.Onboard.Control.ControlTypes;
using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Telemetry;
using SignalRC.Shared.Channels;

namespace SignalRC.Onboard.Services;

// ponytail: enumerates every ControlType the Onboard knows about (via the
// [ControlType("...")] attribute) and every concrete TelemetryReaderBase
// subclass. The Server caches this per carId so the channel-config UI
// can offer autocomplete that's never out of sync with the running build.
// Reflection cost is paid once at startup; the result is cached statically.
public class AvailableChannelTypesService
{
    private static readonly Lazy<AvailableChannelTypes> _cache = new(BuildTypes);

    // Audio devices are re-read on every (re)connect: USB sound cards come and go.
    public AvailableChannelTypes GetAvailableTypes() => new()
    {
        ControlTypes = _cache.Value.ControlTypes,
        TelemetryTypes = _cache.Value.TelemetryTypes,
        PinManagerTypes = _cache.Value.PinManagerTypes,
        OptionSchemas = _cache.Value.OptionSchemas,
        AudioInputDevices = ListAlsaDevices("arecord"),
        AudioOutputDevices = ListAlsaDevices("aplay"),
    };

    /// <summary>
    /// Hardware devices first as <c>plughw:CARD=…,DEV=…</c> (from <c>-l</c>; plughw converts sample
    /// rate/channels and works without a desktop session, which is what the systemd service has), then
    /// the named PCMs from <c>-L</c>. Plugin aliases without a real card (null, surround*, iec958, …)
    /// are skipped — they only clutter the picker.
    /// </summary>
    private static AudioDeviceInfo[] ListAlsaDevices(string tool)
    {
        var devices = ListHardwareDevices(Run(tool, "-l"));
        foreach (var named in ListNamedDevices(Run(tool, "-L")))
        {
            if (devices.All(d => d.Name != named.Name))
                devices.Add(named);
        }
        return devices.ToArray();
    }

    private static string Run(string tool, string args)
    {
        try
        {
            var startInfo = new ProcessStartInfo(tool, args)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            };
            // `-l` output is localized ("Karte 1: …"); the parser expects English.
            startInfo.Environment["LC_ALL"] = "C";
            using var process = Process.Start(startInfo);
            if (process == null) return string.Empty;
            var output = process.StandardOutput.ReadToEnd();
            if (!process.WaitForExit(3000)) process.Kill();
            return output;
        }
        catch
        {
            // alsa-utils not installed (e.g. dev machine) — no devices to offer.
            return string.Empty;
        }
    }

    // "card 1: Device [USB Audio Device], device 0: USB Audio [USB Audio]"
    private static readonly System.Text.RegularExpressions.Regex HardwareLine =
        new(@"^card \d+: (?<card>\S+) \[(?<cardName>[^\]]*)\], device (?<dev>\d+): [^\[]*\[(?<devName>[^\]]*)\]");

    private static List<AudioDeviceInfo> ListHardwareDevices(string output)
    {
        var devices = new List<AudioDeviceInfo>();
        foreach (var line in output.Split('\n'))
        {
            var m = HardwareLine.Match(line.Trim());
            if (!m.Success) continue;
            devices.Add(new AudioDeviceInfo
            {
                Name = $"plughw:CARD={m.Groups["card"].Value},DEV={m.Groups["dev"].Value}",
                Description = $"{m.Groups["cardName"].Value}, {m.Groups["devName"].Value}",
            });
        }
        return devices;
    }

    private static List<AudioDeviceInfo> ListNamedDevices(string output)
    {
        var skipped = new[] { "null", "surround", "iec958", "front:", "rear:", "center_lfe:", "side:", "dmix:", "dsnoop:", "usbstream:", "lavrate", "samplerate", "speexrate", "speex", "jack", "oss", "upmix", "vdownmix" };
        var devices = new List<AudioDeviceInfo>();
        AudioDeviceInfo? current = null;
        foreach (var line in output.Split('\n'))
        {
            if (line.Length == 0) continue;
            if (!char.IsWhiteSpace(line[0]))
            {
                var name = line.Trim();
                current = skipped.Any(prefix => name.StartsWith(prefix, StringComparison.Ordinal)) ? null : new AudioDeviceInfo { Name = name };
                if (current != null) devices.Add(current);
            }
            else if (current != null)
            {
                var text = line.Trim();
                current.Description = string.IsNullOrEmpty(current.Description) ? text : $"{current.Description}, {text}";
            }
        }
        return devices;
    }

    private static AvailableChannelTypes BuildTypes()
    {
        var asm = typeof(AvailableChannelTypesService).Assembly;
        var docs = XmlDocs.Load(asm);
        var types = asm.GetTypes().Where(t => t.IsClass && !t.IsAbstract && (t.IsPublic || t.IsNestedPublic)).ToArray();

        var controls = types
            .Where(t => typeof(ControlTypeBase).IsAssignableFrom(t))
            .Select(t => (Type: t, Name: t.GetCustomAttribute<ControlTypeAttribute>()?.TypeName))
            .Where(c => !string.IsNullOrEmpty(c.Name))
            .GroupBy(c => c.Name!, StringComparer.Ordinal)
            .Select(g => (Name: g.Key, g.First().Type))
            .OrderBy(c => c.Name, StringComparer.Ordinal)
            .ToArray();

        var telemetry = types
            .Where(t => typeof(TelemetryReaderBase).IsAssignableFrom(t))
            .Select(t => (Name: t.FullName ?? t.Name, Type: t))
            .DistinctBy(t => t.Name)
            .OrderBy(t => t.Name, StringComparer.Ordinal)
            .ToArray();

        // ModuleManagerFactory resolves the "type" of a pin manager by class name.
        var pinManagers = types
            .Where(t => typeof(IModuleManager).IsAssignableFrom(t))
            .Select(t => (t.Name, Type: t))
            .DistinctBy(t => t.Name)
            .OrderBy(t => t.Name, StringComparer.Ordinal)
            .ToArray();

        var schemas = new List<ChannelTypeSchema>();
        schemas.AddRange(pinManagers.Select(p => OptionSchemaBuilder.Build(ChannelTypeSchema.PinManager, p.Name, p.Type, docs)));
        schemas.AddRange(controls.Select(c => OptionSchemaBuilder.Build(ChannelTypeSchema.Control, c.Name, c.Type, docs)));
        schemas.AddRange(telemetry.Select(t => OptionSchemaBuilder.Build(ChannelTypeSchema.Telemetry, t.Name, t.Type, docs, [GroupKeyOption])));
        schemas.AddRange(MediaMtxConfigurator.OptionSchemas());

        return new AvailableChannelTypes
        {
            ControlTypes = controls.Select(c => c.Name).ToArray(),
            TelemetryTypes = telemetry.Select(t => t.Name).ToArray(),
            PinManagerTypes = pinManagers.Select(p => p.Name).ToArray(),
            OptionSchemas = schemas.ToArray(),
        };
    }

    private static readonly OptionSchema GroupKeyOption = new()
    {
        Name = ChannelOptionBinder.GroupKeyOption,
        Type = "string",
        Description = "Telemetry channels with the same group key share one reader instance; defaults to the channel name.",
    };
}

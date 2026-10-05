using System.Runtime.InteropServices;

namespace LteCar.Onboard.Services;

/// <summary>
/// Löst den stabilen CarIdentityKey auf – unabhängig vom aktuellen Config-Ordner.
/// Reihenfolge:
/// 1. Override-Datei (/etc/ltecar/carIdentityKey.txt), z. B. für Debug oder Ersatz-Hardware.
/// 2. Hardware-Serial aus /proc/cpuinfo (Raspberry Pi).
/// 3. Fallback-Datei unter ~/.config/ltecar/carIdentityKey.txt (wird einmalig erzeugt).
/// </summary>
public static class CarIdentityService
{
    private const string OverridePath = "/etc/ltecar/carIdentityKey.txt";
    private const string ProcCpuInfo = "/proc/cpuinfo";

    public static string ResolveCarIdentityKey()
    {
        var overrideKey = TryReadOverrideFile();
        if (!string.IsNullOrWhiteSpace(overrideKey))
        {
            Console.WriteLine($"Using override Car Identity Key from {OverridePath}");
            return overrideKey;
        }

        var hardwareSerial = TryReadHardwareSerial();
        if (!string.IsNullOrWhiteSpace(hardwareSerial))
        {
            Console.WriteLine($"Using hardware Car Identity Key from {ProcCpuInfo}: {hardwareSerial}");
            return hardwareSerial;
        }

        return GetOrCreateFallbackIdentity();
    }

    private static string? TryReadOverrideFile()
    {
        try
        {
            if (File.Exists(OverridePath))
            {
                var key = File.ReadAllText(OverridePath).Trim();
                if (!string.IsNullOrWhiteSpace(key))
                    return key;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Warning: could not read override identity file {OverridePath}: {ex.Message}");
        }
        return null;
    }

    private static string? TryReadHardwareSerial()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            return null;

        try
        {
            if (!File.Exists(ProcCpuInfo))
                return null;

            foreach (var line in File.ReadLines(ProcCpuInfo))
            {
                if (!line.StartsWith("Serial", StringComparison.OrdinalIgnoreCase))
                    continue;

                var parts = line.Split(':', 2);
                if (parts.Length != 2)
                    continue;

                var serial = parts[1].Trim();
                // Invalid/default serials (z. B. bei QEMU oder fehlenden OTP-Bits) ignorieren.
                if (string.IsNullOrWhiteSpace(serial) || serial.All(c => c == '0'))
                    continue;

                return serial;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Warning: could not read hardware serial from {ProcCpuInfo}: {ex.Message}");
        }
        return null;
    }

    private static string GetOrCreateFallbackIdentity()
    {
        var fallbackDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "ltecar");
        var fallbackPath = Path.Combine(fallbackDir, "carIdentityKey.txt");

        try
        {
            if (File.Exists(fallbackPath))
            {
                var existing = File.ReadAllText(fallbackPath).Trim();
                if (!string.IsNullOrWhiteSpace(existing))
                    return existing;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Warning: could not read fallback identity file {fallbackPath}: {ex.Message}");
        }

        var newKey = Guid.NewGuid().ToString();
        try
        {
            Directory.CreateDirectory(fallbackDir);
            File.WriteAllText(fallbackPath, newKey);
            Console.WriteLine($"New fallback Car Identity Key created: {newKey}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Warning: could not write fallback identity file {fallbackPath}: {ex.Message}");
        }

        return newKey;
    }
}

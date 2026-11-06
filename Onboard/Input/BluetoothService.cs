using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Flow;

namespace SignalRC.Onboard.Input;

/// <summary>
/// Pairs controllers with the vehicle through bluetoothctl (OF08). Pairing runs an
/// interactive bluetoothctl with a NoInputNoOutput agent, as gamepads pair without PIN.
/// One action at a time.
/// </summary>
public sealed partial class BluetoothService
{
    private readonly ILogger<BluetoothService> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public BluetoothService(ILogger<BluetoothService> logger)
    {
        _logger = logger;
    }

    public async Task<BluetoothResult> ExecuteAsync(string action, string? address)
    {
        if (!OperatingSystem.IsLinux())
            return Fail("Bluetooth is only available on Linux.");
        var needsAddress = action is BluetoothAction.Pair or BluetoothAction.Connect or BluetoothAction.Disconnect or BluetoothAction.Remove;
        if (needsAddress && (address == null || !Address().IsMatch(address)))
            return Fail("Invalid Bluetooth address.");
        if (!await _gate.WaitAsync(TimeSpan.FromSeconds(1)))
            return Fail("Another Bluetooth action is running.");
        try
        {
            string? message = null;
            var success = true;
            // Scanning, pairing and connecting need a powered adapter; switch it on, or say why not.
            if (action is BluetoothAction.Scan or BluetoothAction.Pair or BluetoothAction.Connect)
            {
                var powerError = await EnsurePoweredAsync();
                if (powerError != null)
                {
                    _logger.LogWarning("Bluetooth {Action}: {Error}", action, powerError);
                    return new BluetoothResult { Success = false, Message = powerError, Devices = await ListAsync() };
                }
            }
            switch (action)
            {
                case BluetoothAction.List:
                    // An adapter that is off lists nothing; say so instead of an empty "ok".
                    var (powered, state) = await AdapterStateAsync();
                    if (!powered)
                        (success, message) = (false, PowerMessage(state));
                    break;
                case BluetoothAction.Scan:
                    var scan = StripAnsi(await RunAsync(["--timeout", "10", "scan", "on"], TimeSpan.FromSeconds(15)));
                    var scanError = scan.Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.StartsWith("Failed", StringComparison.OrdinalIgnoreCase));
                    if (scanError != null)
                        (success, message) = (false, scanError);
                    break;
                case BluetoothAction.Pair:
                    (success, message) = await PairAsync(address!.ToUpperInvariant());
                    break;
                case BluetoothAction.Connect:
                    (success, message) = Outcome(await RunAsync(["--timeout", "15", "connect", address!], TimeSpan.FromSeconds(20)), "Connection successful");
                    break;
                case BluetoothAction.Disconnect:
                    (success, message) = Outcome(await RunAsync(["disconnect", address!], TimeSpan.FromSeconds(10)), "Successful disconnected");
                    break;
                case BluetoothAction.Remove:
                    (success, message) = Outcome(await RunAsync(["remove", address!], TimeSpan.FromSeconds(10)), "Device has been removed");
                    break;
                default:
                    return Fail($"Unknown action '{action}'.");
            }
            _logger.LogInformation("Bluetooth {Action} {Address}: {Result}", action, address, success ? "ok" : message);
            return new BluetoothResult { Success = success, Message = message, Devices = await ListAsync() };
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Bluetooth {Action} failed.", action);
            return Fail(ex.Message);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Powered flag and PowerState ("on", "off", "off-blocked" …) of the default adapter.</summary>
    private static async Task<(bool Powered, string State)> AdapterStateAsync()
    {
        var show = StripAnsi(await RunAsync(["show"], TimeSpan.FromSeconds(5)));
        if (show.Contains("No default controller", StringComparison.OrdinalIgnoreCase))
            return (false, "no-controller");
        var state = Regex.Match(show, @"^\s*PowerState:\s*(\S+)", RegexOptions.Multiline).Groups[1].Value;
        return (Flag(show, "Powered"), state.Length > 0 ? state : "unknown");
    }

    private static string PowerMessage(string state) => state switch
    {
        "no-controller" => "No Bluetooth adapter found on the vehicle.",
        _ when state.Contains("blocked", StringComparison.OrdinalIgnoreCase) =>
            "Bluetooth is blocked by rfkill on the vehicle. Unblock it once as root: 'sudo rfkill unblock bluetooth' (on Raspberry Pi OS also set the WLAN country), see Docs/OnboardFlow.md.",
        _ => $"The Bluetooth adapter is off ({state}) and could not be switched on.",
    };

    /// <summary>Switches the adapter on if needed; null when it is powered, otherwise the reason.</summary>
    private static async Task<string?> EnsurePoweredAsync()
    {
        var (powered, state) = await AdapterStateAsync();
        if (powered) return null;
        if (state == "no-controller" || state.Contains("blocked", StringComparison.OrdinalIgnoreCase))
            return PowerMessage(state);
        await RunAsync(["power", "on"], TimeSpan.FromSeconds(5));
        (powered, state) = await AdapterStateAsync();
        return powered ? null : PowerMessage(state);
    }

    private static BluetoothResult Fail(string message) => new() { Success = false, Message = message };

    private static (bool, string?) Outcome(string output, string successText) =>
        output.Contains(successText, StringComparison.OrdinalIgnoreCase) ? (true, null) : (false, LastLine(output));

    private static string? LastLine(string output) =>
        output.Split('\n').Select(l => StripAnsi(l).Trim()).LastOrDefault(l => l.Length > 0);

    private async Task<List<BluetoothDeviceInfo>> ListAsync()
    {
        var devices = new List<BluetoothDeviceInfo>();
        var list = await RunAsync(["devices"], TimeSpan.FromSeconds(5));
        foreach (Match m in DeviceLine().Matches(StripAnsi(list)))
        {
            var info = StripAnsi(await RunAsync(["info", m.Groups[1].Value], TimeSpan.FromSeconds(5)));
            devices.Add(new BluetoothDeviceInfo
            {
                Address = m.Groups[1].Value,
                Name = m.Groups[2].Value.Trim(),
                Paired = Flag(info, "Paired"),
                Trusted = Flag(info, "Trusted"),
                Connected = Flag(info, "Connected"),
            });
        }
        // Paired and connected first; unnamed devices (name = address) last.
        return devices
            .OrderByDescending(d => d.Connected).ThenByDescending(d => d.Paired)
            .ThenBy(d => d.Name.Replace('-', ':') == d.Address).ThenBy(d => d.Name)
            .ToList();
    }

    private static bool Flag(string info, string name) =>
        Regex.IsMatch(info, $@"^\s*{name}:\s*yes\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase);

    /// <summary>Pair, trust and connect in one interactive session with a NoInputNoOutput agent.</summary>
    private async Task<(bool, string?)> PairAsync(string address)
    {
        var psi = new ProcessStartInfo("bluetoothctl")
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("bluetoothctl could not be started.");
        var output = new StringBuilder();
        var outputLock = new object();
        void Collect(string? line) { if (line != null) lock (outputLock) output.AppendLine(StripAnsi(line)); }
        process.OutputDataReceived += (_, e) => Collect(e.Data);
        process.ErrorDataReceived += (_, e) => Collect(e.Data);
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        async Task<string?> Send(string command, string[] success, string[] failure, TimeSpan timeout)
        {
            int start;
            lock (outputLock) start = output.Length;
            await process.StandardInput.WriteLineAsync(command);
            await process.StandardInput.FlushAsync();
            var until = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < until)
            {
                string text;
                lock (outputLock) text = output.ToString(start, output.Length - start);
                if (success.Any(s => text.Contains(s, StringComparison.OrdinalIgnoreCase))) return null;
                var failed = failure.FirstOrDefault(f => text.Contains(f, StringComparison.OrdinalIgnoreCase));
                if (failed != null) return LastLine(text) ?? failed;
                await Task.Delay(100);
            }
            return $"Timeout: {command}";
        }

        try
        {
            await Send("power on", ["Changing power on succeeded", "succeeded"], [], TimeSpan.FromSeconds(3));
            await Send("agent NoInputNoOutput", ["Agent registered", "already registered"], [], TimeSpan.FromSeconds(3));
            await Send("default-agent", ["Default agent request successful"], [], TimeSpan.FromSeconds(3));
            var error = await Send($"pair {address}", ["Pairing successful", "AlreadyExists"], ["Failed to pair", "not available"], TimeSpan.FromSeconds(30));
            if (error != null) return (false, error);
            error = await Send($"trust {address}", ["trust succeeded"], ["Failed"], TimeSpan.FromSeconds(5));
            if (error != null) return (false, error);
            error = await Send($"connect {address}", ["Connection successful"], ["Failed to connect"], TimeSpan.FromSeconds(20));
            return error != null ? (false, error) : (true, null);
        }
        finally
        {
            try
            {
                await process.StandardInput.WriteLineAsync("quit");
                await process.StandardInput.FlushAsync();
                if (!process.WaitForExit(2000)) process.Kill();
            }
            catch { /* already ended */ }
        }
    }

    private static async Task<string> RunAsync(string[] args, TimeSpan timeout)
    {
        var psi = new ProcessStartInfo("bluetoothctl")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            UseShellExecute = false,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("bluetoothctl could not be started.");
        process.StandardInput.Close();
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var cts = new CancellationTokenSource(timeout);
        try
        {
            await process.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(); } catch { /* ended */ }
        }
        return await stdout + await stderr;
    }

    private static string StripAnsi(string s) => Ansi().Replace(s, string.Empty).Replace("\r", string.Empty);

    [GeneratedRegex("^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")]
    private static partial Regex Address();

    [GeneratedRegex(@"Device\s+((?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2})\s+(.*)$", RegexOptions.Multiline)]
    private static partial Regex DeviceLine();

    [GeneratedRegex(@"\x1B\[[0-9;?]*[A-Za-z]|\x01|\x02")]
    private static partial Regex Ansi();
}

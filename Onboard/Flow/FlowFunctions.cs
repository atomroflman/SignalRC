namespace SignalRC.Onboard.Flow;

/// <summary>What a function sees besides its inputs and parameters.</summary>
public interface IFlowFunctionContext
{
    /// <summary>Monotonic time in milliseconds.</summary>
    long NowMs { get; }
    /// <summary>Telemetry value by channel name, null if unknown. Valid = fresh and not erroneous.</summary>
    (string Value, bool Valid)? Telemetry(string channelName);
    /// <summary>Disconnects the vehicle's Bluetooth controllers matching the filter (name part or address; empty = all).</summary>
    void DisconnectControllers(string? filter);
    /// <summary>Publishes a value for FlowValueReader telemetry channels with this key.</summary>
    void PublishTelemetry(string key, double value);
    /// <summary>Rumble of the vehicle's matching controllers (strengths 0…1); asked for every evaluation.</summary>
    void ControllerRumble(string? filter, double strong, double weak);
    /// <summary>Light bar colour of the vehicle's matching controllers (channels 0…1).</summary>
    void ControllerLight(string? filter, double red, double green, double blue);
}

/// <summary>
/// A flow function of the onboard engine. Same name, ports and behaviour as the
/// browser function in Client/src/components/filters (T15).
/// </summary>
public abstract class FlowFunction
{
    public abstract string Name { get; }
    public abstract string[] Inputs { get; }
    public abstract string[] Outputs { get; }

    /// <summary>Per-node state; null for stateless functions.</summary>
    public virtual object? CreateState() => null;

    /// <summary>
    /// One evaluation. Unconnected inputs are 0, as in the browser engine. Outputs are
    /// numbers; text outputs are already converted like edgeValue (numeric text or 0).
    /// </summary>
    public abstract double[] Apply(IReadOnlyDictionary<string, double> inputs, IReadOnlyDictionary<string, string?> p, object? state, IFlowFunctionContext ctx);

    protected static double In(IReadOnlyDictionary<string, double> inputs, string name) =>
        inputs.TryGetValue(name, out var v) ? v : 0;
}

public static class FlowFunctions
{
    private static readonly Dictionary<string, FlowFunction> All = new FlowFunction[]
    {
        new AbsFn(), new ClampFn(), new DeadZoneFn(), new ReverseFn(), new AddFn(), new SubtractFn(),
        new MultiplyFn(), new DivideFn(), new ModuloFn(), new PowerFn(), new LogFn(), new IifFn(),
        new ToggleFn(), new TurnSignalFn(), new RescaleFn(), new GearboxFn(), new FloatValueFn(),
        new SmoothFn(), new SignFn(), new HudSignalFn(), new HudInputFn(), new TelemetryFn(),
        new ActiveFn(), new PriorityFn(), new MaxFn(), new MinFn(), new DisconnectControllerFn(), new TelemetryOutFn(),
        new ControllerRumbleFn(), new ControllerLightFn(),
    }.ToDictionary(f => f.Name, StringComparer.Ordinal);

    public static FlowFunction? Get(string? name) => name != null && All.TryGetValue(name, out var f) ? f : null;

    public static IEnumerable<string> Names => All.Keys;
}

internal sealed class AbsFn : FlowFunction
{
    public override string Name => "Abs";
    public override string[] Inputs => ["input"];
    public override string[] Outputs => ["absolute"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c) => [Math.Abs(In(i, "input"))];
}

internal sealed class ClampFn : FlowFunction
{
    public override string Name => "Clamp";
    public override string[] Inputs => ["input"];
    public override string[] Outputs => ["output"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var min = JsNumber.Param(p, "min", -1);
        var max = JsNumber.Param(p, "max", 1);
        var v = In(i, "input");
        if (double.IsNaN(min) || double.IsNaN(max) || double.IsNaN(v)) return [double.NaN];
        return [Math.Max(min, Math.Min(max, v))];
    }
}

internal sealed class DeadZoneFn : FlowFunction
{
    public override string Name => "DeadZone";
    public override string[] Inputs => ["input"];
    public override string[] Outputs => ["output"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var input = In(i, "input");
        if (!double.IsFinite(input)) return [0];
        var raw = JsNumber.Param(p, "deadzone", 0.05);
        var deadzone = double.IsFinite(raw) ? Math.Min(Math.Max(Math.Abs(raw), 0), 0.999) : 0.05;
        var rescale = JsNumber.Param(p, "rescale", 1) != 0;
        var magnitude = Math.Abs(input);
        if (magnitude <= deadzone) return [0];
        if (!rescale) return [input];
        return [Math.Sign(input) * (magnitude - deadzone) / (1 - deadzone)];
    }
}

internal sealed class ReverseFn : FlowFunction
{
    public override string Name => "Reverse";
    public override string[] Inputs => ["input"];
    public override string[] Outputs => ["output"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c) => [-In(i, "input")];
}

internal abstract class BinaryFn : FlowFunction
{
    public override string[] Inputs => ["a", "b"];
    protected abstract double Op(double a, double b);
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c) => [Op(In(i, "a"), In(i, "b"))];
}

internal sealed class AddFn : BinaryFn
{
    public override string Name => "Add";
    public override string[] Outputs => ["sum"];
    protected override double Op(double a, double b) => a + b;
}

internal sealed class MaxFn : BinaryFn
{
    public override string Name => "Max";
    public override string[] Outputs => ["max"];
    protected override double Op(double a, double b) => Math.Max(a, b);
}

internal sealed class MinFn : BinaryFn
{
    public override string Name => "Min";
    public override string[] Outputs => ["min"];
    protected override double Op(double a, double b) => Math.Min(a, b);
}

internal sealed class SubtractFn : BinaryFn
{
    public override string Name => "Subtract";
    public override string[] Outputs => ["difference"];
    protected override double Op(double a, double b) => a - b;
}

internal sealed class MultiplyFn : BinaryFn
{
    public override string Name => "Multiply";
    public override string[] Outputs => ["result"];
    protected override double Op(double a, double b) => a * b;
}

internal sealed class DivideFn : BinaryFn
{
    public override string Name => "Divide";
    public override string[] Outputs => ["quotient"];
    protected override double Op(double a, double b) => b == 0 ? 0 : a / b;
}

internal sealed class ModuloFn : BinaryFn
{
    public override string Name => "Modulo";
    public override string[] Outputs => ["remainder"];
    // C# % on doubles truncates like JavaScript %.
    protected override double Op(double a, double b) => b == 0 ? 0 : a % b;
}

internal sealed class PowerFn : FlowFunction
{
    public override string Name => "Power";
    public override string[] Inputs => ["base", "exponent"];
    public override string[] Outputs => ["result"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c) => [Math.Pow(In(i, "base"), In(i, "exponent"))];
}

internal sealed class LogFn : FlowFunction
{
    public override string Name => "Log";
    public override string[] Inputs => ["value", "base"];
    public override string[] Outputs => ["result"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var value = In(i, "value");
        var b = In(i, "base");
        if (value <= 0 || b <= 0 || b == 1) return [0];
        return [Math.Log(value) / Math.Log(b)];
    }
}

internal sealed class IifFn : FlowFunction
{
    public override string Name => "Iif";
    public override string[] Inputs => ["a", "b", "ifTrue", "ifFalse"];
    public override string[] Outputs => ["result"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var a = In(i, "a");
        var b = In(i, "b");
        var op = p.TryGetValue("operator", out var o) && !string.IsNullOrEmpty(o) ? o : ">";
        var condition = op switch
        {
            "<" => a < b,
            "=" or "==" => Math.Abs(a - b) < 0.00001,
            ">=" => a >= b,
            "<=" => a <= b,
            "!=" or "<>" => Math.Abs(a - b) >= 0.00001,
            _ => a > b,
        };
        // Switches "trueIs1" / "falseIs1": that branch outputs 1 instead of its input, so a
        // comparison needs no extra links.
        if (condition) return [Flag(p, "trueIs1") ? 1 : In(i, "ifTrue")];
        return [Flag(p, "falseIs1") ? 1 : In(i, "ifFalse")];
    }

    private static bool Flag(IReadOnlyDictionary<string, string?> p, string name) =>
        p.TryGetValue(name, out var v) && string.Equals(v?.Trim(), "true", StringComparison.OrdinalIgnoreCase);
}

internal sealed class ToggleFn : FlowFunction
{
    private sealed class State { public bool Switch; public bool Toggle; }
    public override string Name => "Toggle";
    public override string[] Inputs => ["input"];
    public override string[] Outputs => ["Out"];
    public override object CreateState() => new State();
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var st = (State)s!;
        var input = JsNumber.Round(In(i, "input"));
        if (input == 1 && !st.Switch) st.Toggle = !st.Toggle;
        st.Switch = input == 1;
        return [st.Toggle ? 1 : 0];
    }
}

internal sealed class TurnSignalFn : FlowFunction
{
    private sealed class State
    {
        public bool Initialized;
        public bool IsEnabled;
        public double InitialSteering;
        public double LastEnable;
        public double MaxStepInDirection;
    }

    public override string Name => "TurnSignal";
    public override string[] Inputs => ["enable", "steering"];
    public override string[] Outputs => ["isEnabled"];
    public override object CreateState() => new State();

    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var st = (State)s!;
        var enable = JsNumber.Round(In(i, "enable"));
        var steering = In(i, "steering");
        var steps = JsNumber.Param(p, "steps", 5);
        if (!double.IsFinite(steps) || steps <= 0) steps = 5;
        var isLeftTurn = !(p.TryGetValue("isLeftTurn", out var l) && string.Equals(l?.Trim(), "false", StringComparison.OrdinalIgnoreCase));
        var clickSize = 1.0 / steps;

        if (!st.Initialized)
        {
            st.Initialized = true;
            st.InitialSteering = steering;
        }

        if (st.LastEnable == 0 && enable == 1)
        {
            st.IsEnabled = !st.IsEnabled;
            if (st.IsEnabled)
            {
                st.InitialSteering = steering;
                st.MaxStepInDirection = 0;
            }
        }
        st.LastEnable = enable;

        if (st.IsEnabled)
        {
            var stepIndex = Math.Floor((steering - st.InitialSteering) / clickSize);
            if (isLeftTurn)
            {
                if (stepIndex < st.MaxStepInDirection) st.MaxStepInDirection = stepIndex;
                if (stepIndex > st.MaxStepInDirection) st.IsEnabled = false;
            }
            else
            {
                if (stepIndex > st.MaxStepInDirection) st.MaxStepInDirection = stepIndex;
                if (stepIndex < st.MaxStepInDirection) st.IsEnabled = false;
            }
        }
        return [st.IsEnabled ? 1 : 0];
    }
}

internal sealed class RescaleFn : FlowFunction
{
    public override string Name => "Rescale";
    public override string[] Inputs => ["input"];
    public override string[] Outputs => ["output"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var input = In(i, "input");
        var inMin = JsNumber.Param(p, "inMin", -1);
        var inMax = JsNumber.Param(p, "inMax", 1);
        var outMin = JsNumber.Param(p, "outMin", 0);
        var outMax = JsNumber.Param(p, "outMax", 1);
        if (inMax == inMin) return [outMin];
        var ratio = (input - inMin) / (inMax - inMin);
        return [outMin + ratio * (outMax - outMin)];
    }
}

internal sealed class GearboxFn : FlowFunction
{
    private sealed class State { public bool Initialized; public int Gear; public double LastUp; public double LastDown; }
    public override string Name => "Gearbox";
    public override string[] Inputs => ["shiftUp", "shiftDown"];
    public override string[] Outputs => ["currentGear", "gearValue", "gearName"];
    public override object CreateState() => new State();

    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var st = (State)s!;
        var up = JsNumber.Round(In(i, "shiftUp"));
        var down = JsNumber.Round(In(i, "shiftDown"));
        var initialGear = 1;
        if (p.TryGetValue("initialGear", out var ig) && ig != null && ig != "")
        {
            var parsed = JsNumber.Parse(ig);
            if (double.IsFinite(parsed)) initialGear = (int)JsNumber.Round(parsed);
        }
        var names = (p.TryGetValue("gearNames", out var gn) && gn != null ? gn : "R,N,1,2,3,4,5")
            .Split(',').Select(n => n.Trim()).ToArray();
        var maxGear = names.Length - 1;

        if (!st.Initialized)
        {
            st.Initialized = true;
            st.Gear = initialGear;
        }
        if (st.LastUp == 0 && up == 1 && st.Gear < maxGear) st.Gear++;
        if (st.LastDown == 0 && down == 1 && st.Gear > 0) st.Gear--;
        st.LastUp = up;
        st.LastDown = down;
        st.Gear = Math.Max(0, Math.Min(st.Gear, maxGear));

        var name = st.Gear < names.Length && names[st.Gear] != "" ? names[st.Gear] : $"Gear{st.Gear}";
        var gearValue = maxGear > 0 ? (double)st.Gear / maxGear : 0;
        return [st.Gear, gearValue, JsNumber.EdgeValue(name)];
    }
}

internal sealed class FloatValueFn : FlowFunction
{
    public override string Name => "FloatValue";
    public override string[] Inputs => [];
    public override string[] Outputs => ["value"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        // params.value * 1: a missing value is NaN.
        var value = JsNumber.Param(p, "value", double.NaN);
        var min = JsNumber.Param(p, "min", -1);
        var max = JsNumber.Param(p, "max", 1);
        var digits = JsNumber.Param(p, "digits", 6);
        if (double.IsNaN(value) || double.IsNaN(min) || double.IsNaN(max)) return [0];
        var clamped = Math.Max(min, Math.Min(max, value));
        var scale = Math.Pow(10, digits);
        return [JsNumber.Round(clamped * scale) / scale];
    }
}

/// <summary>
/// Moves towards the input like the browser's Smooth: per step the gap shrinks by
/// <c>speed</c>, at <c>fps</c> steps per second. The onboard engine runs on a fixed
/// tick, so the steps since the last evaluation are applied at once.
/// </summary>
internal sealed class SmoothFn : FlowFunction
{
    private sealed class State { public bool Initialized; public double Current; public long LastMs; }
    public override string Name => "Smooth";
    public override string[] Inputs => ["input"];
    public override string[] Outputs => ["output"];
    public override object CreateState() => new State();

    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var st = (State)s!;
        var target = In(i, "input");
        var speed = Clamp(JsNumber.Param(p, "speed", 0.1), 0.01, 1.0, 0.1);
        var threshold = Math.Max(0.0001, Finite(JsNumber.Param(p, "threshold", 0.001), 0.001));
        var fps = Clamp(JsNumber.Param(p, "fps", 60), 10, 120, 60);

        if (!st.Initialized)
        {
            st.Initialized = true;
            st.Current = target;
            st.LastMs = c.NowMs;
            return [target];
        }

        var elapsed = Math.Max(0, c.NowMs - st.LastMs);
        st.LastMs = c.NowMs;
        if (Math.Abs(target - st.Current) <= threshold)
        {
            st.Current = target;
            return [target];
        }
        var steps = elapsed * fps / 1000.0;
        st.Current = target - (target - st.Current) * Math.Pow(1 - speed, steps);
        if (Math.Abs(target - st.Current) <= threshold) st.Current = target;
        return [st.Current];
    }

    private static double Finite(double v, double fallback) => double.IsFinite(v) ? v : fallback;
    private static double Clamp(double v, double min, double max, double fallback) => Math.Max(min, Math.Min(max, Finite(v, fallback)));
}

internal sealed class SignFn : FlowFunction
{
    public override string Name => "Sign";
    public override string[] Inputs => ["input"];
    public override string[] Outputs => ["sign"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var sign = JsNumber.Sign(In(i, "input"));
        return [double.IsNaN(sign) ? 0 : sign];
    }
}

/// <summary>Browser only (T05); kept so a stray node does not break the flow.</summary>
internal sealed class HudSignalFn : FlowFunction
{
    public override string Name => "HudSignal";
    public override string[] Inputs => ["value"];
    public override string[] Outputs => [];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var v = In(i, "value");
        return [double.IsFinite(v) ? v : 0];
    }
}

/// <summary>Browser only (T05): HUD clicks never reach the vehicle, so the value is 0.</summary>
internal sealed class HudInputFn : FlowFunction
{
    public override string Name => "HudInput";
    public override string[] Inputs => [];
    public override string[] Outputs => ["value"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c) => [0];
}

/// <summary>Reads a telemetry channel of this vehicle directly (E05).</summary>
internal sealed class TelemetryFn : FlowFunction
{
    public override string Name => "Telemetry";
    public override string[] Inputs => [];
    public override string[] Outputs => ["value", "valid"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var fallback = JsNumber.Param(p, "fallback", 0);
        if (!double.IsFinite(fallback)) fallback = 0;
        var channel = p.TryGetValue("channel", out var ch) ? ch?.Trim() : null;
        if (string.IsNullOrEmpty(channel)) return [fallback, 0];
        var v = c.Telemetry(channel);
        if (v is not { Valid: true } value) return [fallback, 0];
        return [JsNumber.Telemetry(value.Value), 1];
    }
}

/// <summary>
/// "Aktiv?" (OF02): 1 while |input| exceeds the threshold and for <c>hold</c> seconds after.
/// Detects whether a source is being used, e.g. to let the local controller override the web.
/// </summary>
internal sealed class ActiveFn : FlowFunction
{
    private sealed class State { public long? LastActiveMs; }
    public override string Name => "Active";
    public override string[] Inputs => ["input"];
    public override string[] Outputs => ["active"];
    public override object CreateState() => new State();

    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var st = (State)s!;
        var threshold = JsNumber.Param(p, "threshold", 0.05);
        if (!double.IsFinite(threshold)) threshold = 0.05;
        var hold = JsNumber.Param(p, "hold", 2);
        if (!double.IsFinite(hold) || hold < 0) hold = 2;
        if (Math.Abs(In(i, "input")) > Math.Abs(threshold)) st.LastActiveMs = c.NowMs;
        var active = st.LastActiveMs is { } last && c.NowMs - last <= hold * 1000;
        return [active ? 1 : 0];
    }
}

/// <summary>"Vorrang" (OF02): a while aActive ≥ 0.5, otherwise b.</summary>
internal sealed class PriorityFn : FlowFunction
{
    public override string Name => "Priority";
    public override string[] Inputs => ["a", "aActive", "b"];
    public override string[] Outputs => ["output"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c) =>
        [In(i, "aActive") >= 0.5 ? In(i, "a") : In(i, "b")];
}

/// <summary>
/// "Controller trennen": on a rising edge of trigger (≥ 0.5) the vehicle disconnects its
/// Bluetooth controllers that match <c>device</c> (part of the name or the address; empty:
/// all). For controllers that cannot be switched off, e.g. a PS4 controller. Vehicle flow
/// only; the output is 1 in the evaluation that triggered.
/// </summary>
internal sealed class DisconnectControllerFn : FlowFunction
{
    private sealed class State { public bool Last; }
    public override string Name => "DisconnectController";
    public override string[] Inputs => ["trigger"];
    public override string[] Outputs => ["triggered"];
    public override object CreateState() => new State();
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var st = (State)s!;
        var on = In(i, "trigger") >= 0.5;
        var rising = on && !st.Last;
        st.Last = on;
        if (rising) c.DisconnectControllers(p.TryGetValue("device", out var d) ? d : null);
        return [rising ? 1 : 0];
    }
}

/// <summary>
/// "Telemetrie senden": publishes its input under <c>key</c> every evaluation; a telemetry
/// channel of type FlowValueReader with the same key sends it to the server. Vehicle flow
/// only. Passes the value on.
/// </summary>
internal sealed class TelemetryOutFn : FlowFunction
{
    public override string Name => "TelemetryOut";
    public override string[] Inputs => ["value"];
    public override string[] Outputs => ["value"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var value = In(i, "value");
        var key = p.TryGetValue("key", out var k) ? k?.Trim() : null;
        if (!string.IsNullOrEmpty(key)) c.PublishTelemetry(key, value);
        return [value];
    }
}

/// <summary>
/// "Controller rütteln": rumble of the controllers matching <c>device</c> (name part or
/// address; empty = all), strengths 0…1. In the vehicle flow the vehicle's controllers, in
/// the browser flow the browser's gamepads. Outputs the stronger motor.
/// </summary>
internal sealed class ControllerRumbleFn : FlowFunction
{
    public override string Name => "ControllerRumble";
    public override string[] Inputs => ["strong", "weak"];
    public override string[] Outputs => ["value"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var strong = Math.Clamp(In(i, "strong"), 0, 1);
        var weak = Math.Clamp(In(i, "weak"), 0, 1);
        c.ControllerRumble(p.TryGetValue("device", out var d) ? d : null, strong, weak);
        return [Math.Max(strong, weak)];
    }
}

/// <summary>
/// "Controller Farbe": light bar colour of the vehicle's controllers matching <c>device</c>,
/// channels 0…1. Vehicle flow only (browsers cannot set it). Outputs the brightest channel.
/// </summary>
internal sealed class ControllerLightFn : FlowFunction
{
    public override string Name => "ControllerLight";
    public override string[] Inputs => ["red", "green", "blue"];
    public override string[] Outputs => ["value"];
    public override double[] Apply(IReadOnlyDictionary<string, double> i, IReadOnlyDictionary<string, string?> p, object? s, IFlowFunctionContext c)
    {
        var r = Math.Clamp(In(i, "red"), 0, 1);
        var g = Math.Clamp(In(i, "green"), 0, 1);
        var b = Math.Clamp(In(i, "blue"), 0, 1);
        c.ControllerLight(p.TryGetValue("device", out var d) ? d : null, r, g, b);
        return [Math.Max(r, Math.Max(g, b))];
    }
}

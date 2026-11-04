namespace SignalRC.Onboard.Hardware;

/// <summary>A pin manager that can check its own options after they were applied.</summary>
public interface IValidatingModuleManager
{
    /// <summary>One message per configuration problem; reported as channel health warnings.</summary>
    IEnumerable<string> Validate();
}

namespace SignalRC.Onboard.Control;

/// <summary>Where the onboard flow writes its channels (ControlExecutionService; a fake in tests).</summary>
public interface IControlSink
{
    void SetControl(string channel, decimal value);
    /// <summary>Puts the matching channels to neutral.</summary>
    void ReleaseControl(Func<string, bool> include);
}

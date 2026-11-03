using SignalRC.Onboard.Hardware;

namespace SignalRC.Onboard.Control.ControlTypes;

public abstract class ControlTypeBase : IControlType
{
    public int? Address { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool TestDisabled { get; set; } = false;
    public Dictionary<string, object> Options { get; set; } = new Dictionary<string, object>();
    public IModuleManager PinManager { get; set; } = null!;

    public virtual void Initialize() { }
    public async Task RunTestAsync()
    {
        if (!TestDisabled)
            await RunTestInternalAsync();
    }
    protected virtual Task RunTestInternalAsync() => Task.CompletedTask;
    public abstract void OnControlRecived(decimal newValue);
    public abstract void OnControlReleased();

    /// <summary>Set by ControlExecutionService: a task passed to <see cref="Observe"/> failed.</summary>
    public Action<Exception>? BackgroundFailed { get; set; }
    /// <summary>Set by ControlExecutionService: a task passed to <see cref="Observe"/> completed.</summary>
    public Action? BackgroundSucceeded { get; set; }

    /// <summary>
    /// For hardware writes, fades and commands that run on after OnControlRecived
    /// returned. Nobody awaits them, so without this their exception is dropped
    /// silently: neither the log nor the channel health would see it. Cancellation
    /// (a newer value replaced the fade) is not an error.
    /// </summary>
    protected void Observe(Task task)
    {
        if (task.IsCompletedSuccessfully)
        {
            BackgroundSucceeded?.Invoke();
            return;
        }
        task.ContinueWith(t =>
        {
            if (t.IsFaulted)
                BackgroundFailed?.Invoke(t.Exception!.InnerExceptions.Count == 1 ? t.Exception.InnerException! : t.Exception);
            else if (t.IsCompletedSuccessfully)
                BackgroundSucceeded?.Invoke();
        }, TaskContinuationOptions.ExecuteSynchronously);
    }
}

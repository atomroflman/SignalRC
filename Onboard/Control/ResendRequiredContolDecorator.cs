using System;
using System.Diagnostics;
using System.Threading;
using SignalRC.Onboard.Control.ControlTypes;
using SignalRC.Onboard.Hardware;

namespace SignalRC.Onboard.Control;

public sealed class ResendRequiredContolDecorator : IControlType, IDisposable
{
    private readonly IControlType _inner;
    private readonly TimeSpan _timeout;
    private readonly Timer _timer;
    private readonly Stopwatch _clock = Stopwatch.StartNew();

    private long _lastUpdateMs;
    private bool _released = true;

    public ResendRequiredContolDecorator(
        IControlType inner,
        TimeSpan timeout,
        TimeSpan checkInterval)
    {
        _inner = inner;
        _timeout = timeout;

        _lastUpdateMs = _clock.ElapsedMilliseconds;

        _timer = new Timer(
            CheckTimeout,
            null,
            checkInterval,
            checkInterval);
    }

    // --- Interface-Weiterleitung ---
    public int? Address
    {
        get => _inner.Address;
        set => _inner.Address = value;
    }

    public string Name
    {
        get => _inner.Name;
        set => _inner.Name = value;
    }

    public bool TestDisabled
    {
        get => _inner.TestDisabled;
        set => _inner.TestDisabled = value;
    }

    public Dictionary<string, object> Options
    {
        get => _inner.Options;
        set => _inner.Options = value;
    }

    public IModuleManager PinManager
    {
        get => _inner.PinManager;
        set => _inner.PinManager = value;
    }

    public void Initialize() => _inner.Initialize();
    public Task RunTestAsync() => _inner.RunTestAsync();

    // --- Kernlogik ---
    public void OnControlRecived(decimal newValue)
    {
        _lastUpdateMs = _clock.ElapsedMilliseconds;
        _released = false;

        _inner.OnControlRecived(newValue);
    }

    public void OnControlReleased()
    {
        ForceRelease();
    }

    private void CheckTimeout(object? state)
    {
        if (_released)
            return;

        if (_clock.ElapsedMilliseconds - _lastUpdateMs >= _timeout.TotalMilliseconds)
            ForceRelease();
    }

    private void ForceRelease()
    {
        if (_released)
            return;

        _released = true;
        _inner.OnControlReleased();
    }

    public void Dispose()
    {
        _timer.Dispose();
    }
}
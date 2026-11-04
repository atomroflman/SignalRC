namespace SignalRC.Server.Telemetry;

/// <summary>Outgoing side of the control display relay.</summary>
public interface IControlDisplayTransport
{
    /// <summary>Ctl(carId, driverEpoch, seq, paused, ageMs, outputs, signals, removedOutputs, removedSignals).</summary>
    Task SendAsync(string connectionId, int carId, string driverEpoch, long seq, bool paused, int ageMs,
        object[][] outputs, object[][] signals, int[] removedOutputs, string[] removedSignals);
    Task SendClearedAsync(string connectionId, int carId, string driverEpoch);
    /// <summary>CtlDemand(carId, needed) to the driver.</summary>
    Task SendDemandAsync(string driverConnectionId, int carId, bool needed);
}

/// <summary>
/// Display-only relay of the active driver's computed outputs and named flow
/// signals (Shared/Overlay/telemetry/README.md §7). Only the connection that
/// acquired control may publish; nothing here ever reaches the vehicle.
/// </summary>
public sealed class ControlDisplayRelay(IControlDisplayTransport transport, TimeProvider time, ILogger<ControlDisplayRelay> logger)
{
    private sealed class Car
    {
        public readonly object Lock = new();
        public string? Driver;
        public string Epoch = "";
        public long Seq = -1;
        public bool Paused;
        public long ReceivedAt;
        public bool HasData;
        public readonly Dictionary<int, double> Outputs = [];
        public readonly Dictionary<string, double> Signals = new(StringComparer.Ordinal);
        public readonly HashSet<string> Viewers = [];
        public bool? SentDemand;
    }

    private readonly Dictionary<int, Car> _cars = [];
    private readonly object _carsLock = new();
    private long _rejected;

    private Car Get(int carId)
    {
        lock (_carsLock)
        {
            if (!_cars.TryGetValue(carId, out var car)) _cars[carId] = car = new Car();
            return car;
        }
    }

    private long Now => time.GetTimestamp() * 1000 / time.TimestampFrequency;

    /// <summary>The connection that holds control of the car, or null (D75 forwards viewer HUD clicks there).</summary>
    public string? DriverConnection(int carId)
    {
        var car = Get(carId);
        lock (car.Lock) return car.Driver;
    }

    /// <summary>A connection acquired control: new epoch, old values are void (D07).</summary>
    public async Task ControlAcquiredAsync(int carId, string driverConnectionId)
    {
        var car = Get(carId);
        string? oldEpoch;
        string[] viewers;
        lock (car.Lock)
        {
            oldEpoch = car.HasData ? car.Epoch : null;
            Reset(car);
            car.Driver = driverConnectionId;
            car.Epoch = Guid.NewGuid().ToString("N")[..12];
            viewers = car.Viewers.ToArray();
        }
        if (oldEpoch != null) foreach (var v in viewers) await transport.SendClearedAsync(v, carId, oldEpoch);
        await UpdateDemandAsync(carId, car, force: true);
    }

    /// <summary>Control released or the driver's connection closed.</summary>
    public async Task ControlEndedAsync(int carId)
    {
        var car = Get(carId);
        string epoch;
        string[] viewers;
        lock (car.Lock)
        {
            if (car.Driver == null) return;
            epoch = car.Epoch;
            Reset(car);
            car.Driver = null;
            viewers = car.Viewers.ToArray();
        }
        foreach (var v in viewers) await transport.SendClearedAsync(v, carId, epoch);
    }

    private static void Reset(Car car)
    {
        car.Seq = -1;
        car.HasData = false;
        car.Outputs.Clear();
        car.Signals.Clear();
        car.SentDemand = null;
    }

    /// <summary>
    /// A batch from a browser. Accepted only from the driver connection and with
    /// increasing seq; everything else is dropped and logged (rate-limited).
    /// </summary>
    public async Task<bool> PublishAsync(string connectionId, int carId, long seq, bool paused,
        IReadOnlyList<(int Id, double Value)> outputs, IReadOnlyList<(string Name, double Value)> signals,
        IReadOnlyList<int> removedOutputs, IReadOnlyList<string> removedSignals)
    {
        var car = Get(carId);
        string epoch;
        string[] viewers;
        lock (car.Lock)
        {
            if (car.Driver != connectionId || seq <= car.Seq)
            {
                if (Interlocked.Increment(ref _rejected) % 100 == 1)
                {
                    logger.LogWarning("Rejected control display from {Connection} for car {CarId} (not the driver or old seq)", connectionId, carId);
                }
                return false;
            }
            car.Seq = seq;
            car.Paused = paused;
            car.ReceivedAt = Now;
            car.HasData = true;
            foreach (var (id, value) in outputs) car.Outputs[id] = value;
            foreach (var (name, value) in signals) car.Signals[name] = value;
            foreach (var id in removedOutputs) car.Outputs.Remove(id);
            foreach (var name in removedSignals) car.Signals.Remove(name);
            epoch = car.Epoch;
            viewers = car.Viewers.Where(v => v != connectionId).ToArray();
        }
        var o = outputs.Select(x => new object[] { x.Id, x.Value }).ToArray();
        var s = signals.Select(x => new object[] { x.Name, x.Value }).ToArray();
        foreach (var v in viewers)
        {
            await transport.SendAsync(v, carId, epoch, seq, paused, 0, o, s, removedOutputs.ToArray(), removedSignals.ToArray());
        }
        return true;
    }

    /// <summary>A viewer starts or stops needing out()/sig(); a new viewer gets the full current state.</summary>
    public async Task SetInterestAsync(string connectionId, int carId, bool interested)
    {
        var car = Get(carId);
        (string Epoch, long Seq, bool Paused, int Age, object[][] Outputs, object[][] Signals)? snapshot = null;
        lock (car.Lock)
        {
            if (!interested)
            {
                car.Viewers.Remove(connectionId);
            }
            else if (car.Viewers.Add(connectionId) && car.HasData)
            {
                snapshot = (car.Epoch, car.Seq, car.Paused, (int)Math.Min(int.MaxValue, Now - car.ReceivedAt),
                    car.Outputs.OrderBy(kv => kv.Key).Select(kv => new object[] { kv.Key, kv.Value }).ToArray(),
                    car.Signals.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => new object[] { kv.Key, kv.Value }).ToArray());
            }
        }
        if (snapshot is { } s) await transport.SendAsync(connectionId, carId, s.Epoch, s.Seq, s.Paused, s.Age, s.Outputs, s.Signals, [], []);
        await UpdateDemandAsync(carId, car);
    }

    public async Task ConnectionClosedAsync(string connectionId)
    {
        List<(int, Car)> cars;
        lock (_carsLock) cars = _cars.Select(kv => (kv.Key, kv.Value)).ToList();
        foreach (var (carId, car) in cars)
        {
            bool wasDriver, wasViewer;
            lock (car.Lock)
            {
                wasDriver = car.Driver == connectionId;
                wasViewer = car.Viewers.Remove(connectionId);
            }
            if (wasDriver) await ControlEndedAsync(carId);
            else if (wasViewer) await UpdateDemandAsync(carId, car);
        }
    }

    /// <summary>The driver sends only while another connection needs the values (D59).</summary>
    private async Task UpdateDemandAsync(int carId, Car car, bool force = false)
    {
        string driver;
        bool needed;
        lock (car.Lock)
        {
            if (car.Driver == null) return;
            driver = car.Driver;
            needed = car.Viewers.Any(v => v != driver);
            if (!force && car.SentDemand == needed) return;
            car.SentDemand = needed;
        }
        await transport.SendDemandAsync(driver, carId, needed);
    }
}

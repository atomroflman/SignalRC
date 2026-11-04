using SignalRC.Onboard.Telemetry;

namespace SignalRC.Overlay.Tests.Telemetry;

/// <summary>Remaining runtime of the JBD reader from a one hour average of the current.</summary>
public class BatteryRuntimeTests
{
    private static readonly DateTime Start = new(2026, 11, 4, 12, 0, 0, DateTimeKind.Utc);

    private static BatteryRuntimeEstimator Run(double amps, int seconds, DateTime? from = null, BatteryRuntimeEstimator? estimator = null)
    {
        estimator ??= new BatteryRuntimeEstimator();
        for (var s = 0; s <= seconds; s += 10)
            estimator.Add((from ?? Start).AddSeconds(s), amps);
        return estimator;
    }

    [Fact]
    public void NoAverageUntilAMinuteIsCovered()
    {
        Assert.Null(Run(-1.2, 50).AverageAmps());
        Assert.Equal(-1.2, Run(-1.2, 60).AverageAmps()!.Value, 6);
    }

    [Fact]
    public void AShortBurstBarelyMovesTheHourAverage()
    {
        var estimator = Run(-1, 3540);
        Run(-20, 30, Start.AddSeconds(3550), estimator);
        Assert.InRange(estimator.AverageAmps()!.Value, -1.3, -1);
    }

    [Fact]
    public void ValuesOlderThanTheWindowDropOut()
    {
        var estimator = Run(-10, 3600);
        Run(-1, 3600, Start.AddSeconds(3610), estimator);
        Assert.Equal(-1, estimator.AverageAmps()!.Value, 3);
    }

    [Fact]
    public void ALongGapDoesNotCount()
    {
        var estimator = Run(-1, 300);
        // Twenty minutes without a read, then 5 minutes at 3 A: equal weight, not 20 minutes of a guess.
        Run(-3, 300, Start.AddMinutes(25), estimator);
        Assert.Equal(-2, estimator.AverageAmps()!.Value, 1);
    }

    [Theory]
    [InlineData(14.67, -1.34, 10.95)]
    [InlineData(14.67, -10, 1.47)]
    public void RuntimeIsRemainingCapacityOverAverageCurrent(double remaining, double amps, double hours) =>
        Assert.Equal(hours, BatteryRuntimeEstimator.RuntimeHours(remaining, amps)!.Value, 2);

    [Theory]
    [InlineData(5.0)]
    [InlineData(0.0)]
    [InlineData(-0.01)]
    public void NoRuntimeWhileChargingOrIdle(double amps) =>
        Assert.Null(BatteryRuntimeEstimator.RuntimeHours(14.67, amps));

    private static Dictionary<string, string> Read(string current) =>
        new() { ["current"] = current, ["remaining"] = "14.220000267028809", ["soc"] = "71" };

    [Fact]
    public void ReaderAddsAverageAndRuntimeOnceAvailable()
    {
        var estimator = new BatteryRuntimeEstimator();
        var first = JbdBmsTelemetryReader.WithRuntime(Read("-1.1499999761581421"), estimator, Start);
        Assert.False(first.ContainsKey("runtime"));

        var later = JbdBmsTelemetryReader.WithRuntime(Read("-1.1499999761581421"), estimator, Start.AddMinutes(2));
        Assert.Equal("-1.15", later["currentAvg"]);
        Assert.Equal("12.37", later["runtime"]);
        Assert.Equal("71", later["soc"]);
    }

    [Fact]
    public void WhileChargingThereIsAnAverageButNoRuntime()
    {
        var estimator = new BatteryRuntimeEstimator();
        JbdBmsTelemetryReader.WithRuntime(Read("2.5"), estimator, Start);
        var later = JbdBmsTelemetryReader.WithRuntime(Read("2.5"), estimator, Start.AddMinutes(2));
        Assert.Equal("2.5", later["currentAvg"]);
        Assert.False(later.ContainsKey("runtime"));
    }

    [Fact]
    public void AReadWithoutCurrentPassesThrough()
    {
        var values = new Dictionary<string, string> { ["soc"] = "71" };
        Assert.Same(values, JbdBmsTelemetryReader.WithRuntime(values, new BatteryRuntimeEstimator(), Start));
    }
}

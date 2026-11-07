using SignalRC.Onboard.Telemetry;

namespace SignalRC.Overlay.Tests.Telemetry;

// NetworkTrafficReader and CpuLoadReader: parsing of /proc text (samples taken
// from a Raspberry Pi 3B+) and the rate between two readings.
public class SystemLoadReaderTests
{
    private const string NetDev = """
        Inter-|   Receive                                                |  Transmit
         face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
            lo: 543322642  428283    0    0    0     0          0         0 543322642  428283    0    0    0     0       0          0
          eth0:       0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0
         wlan0: 500076805  457776    0    6    0     0          0     52281 803175395  849717    0    0    0     0       0          0
        """;

    [Fact]
    public void NetDev_yields_rx_and_tx_bytes_per_interface()
    {
        var c = NetworkTrafficReader.ParseNetDev(NetDev);
        Assert.Equal(["lo", "eth0", "wlan0"], c.Keys);
        Assert.Equal((500076805L, 803175395L), c["wlan0"]);
    }

    [Fact]
    public void Named_interface_or_all_but_loopback()
    {
        var c = NetworkTrafficReader.ParseNetDev(NetDev);
        Assert.Equal((500076805L, 803175395L), NetworkTrafficReader.Select(c, " wlan0 "));
        Assert.Equal((500076805L, 803175395L), NetworkTrafficReader.Select(c, ""));
        Assert.Null(NetworkTrafficReader.Select(c, "wwan0"));
    }

    [Theory]
    [InlineData(NetworkTrafficReport.Tx, 800.0)]
    [InlineData(NetworkTrafficReport.Rx, 80.0)]
    [InlineData(NetworkTrafficReport.Total, 880.0)]
    public void Rate_in_kbit_per_second(NetworkTrafficReport report, double expected)
    {
        // 20 000 bytes rx and 200 000 bytes tx in 2 s.
        Assert.Equal(expected, NetworkTrafficReader.Rate(report, (1000, 5000), (21000, 205000), 2.0));
    }

    [Fact]
    public void No_rate_after_a_counter_reset_or_without_time()
    {
        Assert.Null(NetworkTrafficReader.Rate(NetworkTrafficReport.Tx, (1000, 5000), (10, 10), 1.0));
        Assert.Null(NetworkTrafficReader.Rate(NetworkTrafficReport.Tx, (1000, 5000), (2000, 6000), 0));
    }

    private const string Stat = """
        cpu  467162 0 141918 1682089 24430 0 13172 0 0 0
        cpu0 116873 0 35908 420205 5471 0 3310 0 0 0
        cpu1 117096 0 35352 420538 6095 0 3293 0 0 0
        intr 118020997 0 0 63904
        """;

    [Fact]
    public void Stat_yields_busy_and_total_for_the_sum_and_each_core()
    {
        var t = CpuLoadReader.ParseStat(Stat);
        Assert.Equal(3, t.Length);
        // busy = user + nice + system + irq + softirq; idle = idle + iowait.
        Assert.Equal(new CpuLoadReader.CpuTimes(467162 + 141918 + 13172, 467162 + 141918 + 1682089 + 24430 + 13172), t[0]);
    }

    [Fact]
    public void Load_is_the_busy_share_of_the_elapsed_time()
    {
        CpuLoadReader.CpuTimes[] before = [new(1000, 4000), new(500, 2000), new(500, 2000)];
        // Core 0 busy 90 of 100, core 1 busy 10 of 100: average 50 %, busiest 90 %.
        CpuLoadReader.CpuTimes[] after = [new(1100, 4200), new(590, 2100), new(510, 2100)];
        Assert.Equal(50.0, CpuLoadReader.Load(CpuLoadReport.Average, before, after));
        Assert.Equal(90.0, CpuLoadReader.Load(CpuLoadReport.BusiestCore, before, after));
    }

    [Fact]
    public void No_load_without_elapsed_time_or_with_a_changed_core_count()
    {
        CpuLoadReader.CpuTimes[] same = [new(1000, 4000)];
        Assert.Null(CpuLoadReader.Load(CpuLoadReport.Average, same, same));
        Assert.Null(CpuLoadReader.Load(CpuLoadReport.Average, [new(1, 2), new(1, 2)], same));
    }

    [Fact]
    public void Load_average_is_the_one_minute_value()
    {
        Assert.Equal(2.63, CpuLoadReader.ParseLoadAverage("2.63 3.54 3.25 4/301 24263\n"));
        Assert.Null(CpuLoadReader.ParseLoadAverage(""));
    }
}

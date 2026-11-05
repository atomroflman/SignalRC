using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Server.Data;
using SignalRC.Server.Telemetry;
using SignalRC.Server.Telemetry.History;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Overlay.Tests.Telemetry;

/// <summary>
/// Recorder and reader against PostgreSQL (COPY, the min/max reduction and the
/// retention are raw SQL). Runs only with SIGNALRC_TEST_POSTGRES set; migrates
/// that database and removes its own vehicle afterwards.
/// </summary>
public class TelemetryHistoryPostgresTests
{
    private static string? ConnectionString => Environment.GetEnvironmentVariable(PostgresOverlayTestDb.Variable);

    [SkippableFact]
    public async Task RecordsReadsReducesContinuesAndExpires()
    {
        Skip.If(string.IsNullOrEmpty(ConnectionString), $"{PostgresOverlayTestDb.Variable} not set");
        var services = new ServiceCollection()
            .AddDbContext<SignalRCContext>(o => o.UseNpgsql(ConnectionString))
            .BuildServiceProvider();
        var scopes = services.GetRequiredService<IServiceScopeFactory>();
        SignalRCContext Db() => services.CreateScope().ServiceProvider.GetRequiredService<SignalRCContext>();

        await Db().Database.MigrateAsync();
        var car = new Car { Name = "history-test", CarIdentityKey = "history-" + Guid.NewGuid().ToString("N")[..12], TelemetryRetentionDays = 1, LastSeen = DateTime.UtcNow };
        var volt = new CarTelemetry { ChannelName = "volt", DataType = TelemetryDataType.Number, Unit = "V", Record = true };
        var flag = new CarTelemetry { ChannelName = "flag", DataType = TelemetryDataType.Boolean, Record = true };
        var text = new CarTelemetry { ChannelName = "text", DataType = TelemetryDataType.String, Record = true };
        var grid = new CarTelemetry { ChannelName = "grid", DataType = TelemetryDataType.LidarGrid, Record = true };
        await using (var db = Db())
        {
            db.Cars.Add(car);
            await db.SaveChangesAsync();
            foreach (var t in new[] { volt, flag, text, grid }) { t.CarId = car.Id; db.CarTelemetry.Add(t); }
            await db.SaveChangesAsync();
        }

        // The test replays 1000 s of samples within a few seconds: the recorder's clock
        // starts at the first sample so its flush timer sees the same times as the samples.
        var clock = new ShiftedClock(TimeSpan.FromSeconds(-1000));
        var recorder = new TelemetryRecorder(scopes, clock, NullLogger<TelemetryRecorder>.Instance);
        using var cts = new CancellationTokenSource();
        await recorder.StartAsync(cts.Token);
        try
        {
            var ids = await recorder.OnboardConnectedAsync(car.Id);
            Assert.Equal(new[] { volt.Id, flag.Id, text.Id }.Order(), ids.Order());

            // 1000 s of a 50 Hz signal with one spike and one gap, flag toggling every 10 s.
            var start = clock.GetUtcNow().UtcDateTime;
            for (var i = 0; i < 50_000; i++)
            {
                var at = start.AddMilliseconds(i * 20);
                var value = i == 25_003 ? "99.5" : (40 - i / 10_000.0).ToString(System.Globalization.CultureInfo.InvariantCulture);
                var state = i is >= 30_000 and < 30_100 ? TelemetrySampleState.NoData : TelemetrySampleState.Valid;
                recorder.OnSamples(car.Id, at, [
                    new RecordedSample(volt.Id, value, state, 0, false),
                    new RecordedSample(flag.Id, (i / 500 % 2).ToString(), TelemetrySampleState.Valid, 0, i % 500 != 0),
                    // status: changes every 100 s, a stale phase around 600 s
                    new RecordedSample(text.Id, $"phase {i / 5_000}", i is >= 30_000 and < 30_050 ? TelemetrySampleState.Stale : TelemetrySampleState.Valid, 0, false),
                ]);
            }
            await Task.Delay(TimeSpan.FromSeconds(3));
            recorder.OnboardDisconnected(car.Id);
            await Task.Delay(TimeSpan.FromSeconds(2));

            TelemetrySession session;
            await using (var db = Db())
            {
                session = await db.TelemetrySessions.SingleAsync(s => s.CarId == car.Id);
                Assert.NotNull(session.EndedAt);
                Assert.NotNull(session.LastSampleAt);
                var voltRows = await db.TelemetrySamples.CountAsync(s => s.SessionId == session.Id && s.ChannelId == volt.Id);
                Assert.InRange(voltRows, 9_900, 10_100); // 10 Hz of 50 Hz
                var flagRows = await db.TelemetrySamples.CountAsync(s => s.SessionId == session.Id && s.ChannelId == flag.Id);
                Assert.InRange(flagRows, 1_000, 1_200); // changes plus one repeat per second
                Assert.Equal(["flag", "text", "volt"], TelemetryRecorder.ReadChannels(session.ChannelsJson).Select(c => c.Name));
                var textRows = await db.TelemetryTextSamples.Where(s => s.SessionId == session.Id).OrderBy(s => s.Time).Select(s => s.Value).ToListAsync();
                // phases 0-5, the gap (it starts where phase 6 would), phases 6-9
                Assert.Equal(11, textRows.Count);
                Assert.Null(textRows[6]);
                Assert.Equal("phase 6", textRows[7]);
                Assert.Equal("phase 0", textRows[0]);
                Assert.Contains(null, textRows);
            }

            var from = TelemetryHistoryReader.Ms(start);
            var to = from + 1_000_000;
            await using (var db = Db())
            {
                var raw = await TelemetryHistoryReader.ReadSamplesAsync(db, session.Id, from + 600_000, from + 601_000, null, 1500);
                Assert.Equal(0, raw.ResolutionMs);
                Assert.Contains(null, raw.Channels[volt.Id].V); // the gap at 600 s
                // the state at the start of the range comes first
                Assert.Equal("phase 5", raw.Texts[text.Id].V[0]);
                Assert.True(raw.Texts[text.Id].T[0] < from + 600_000);

                var reduced = await TelemetryHistoryReader.ReadSamplesAsync(db, session.Id, from, to, null, 100);
                Assert.Equal(10_000, reduced.ResolutionMs);
                Assert.InRange(reduced.Channels[volt.Id].T.Count, 100, 220);
                Assert.Equal(99.5, reduced.Channels[volt.Id].V.Max());
                Assert.True(reduced.Channels[volt.Id].T.SequenceEqual(reduced.Channels[volt.Id].T.Order()));

                var live = await TelemetryHistoryReader.ReadSamplesAsync(db, session.Id, from, to, to - 2_000, 100);
                Assert.Equal(0, live.ResolutionMs);
                Assert.All(live.Channels.Values.SelectMany(c => c.T), t => Assert.True(t > to - 2_000));
            }

            // A reconnect within two minutes continues the session.
            await recorder.OnboardConnectedAsync(car.Id);
            recorder.OnSamples(car.Id, clock.GetUtcNow().UtcDateTime, [new RecordedSample(volt.Id, "1", TelemetrySampleState.Valid, 0, false)]);
            await Task.Delay(TimeSpan.FromSeconds(2));
            await using (var db = Db())
            {
                var again = await db.TelemetrySessions.SingleAsync(s => s.CarId == car.Id);
                Assert.Equal(session.Id, again.Id);
                Assert.Null(again.EndedAt);
            }
            recorder.OnboardDisconnected(car.Id);
            await Task.Delay(TimeSpan.FromSeconds(2));

            // Stopped by the driver: nothing is demanded and a running drive ends.
            await using (var db = Db())
            {
                await db.Cars.Where(c => c.Id == car.Id).ExecuteUpdateAsync(u => u.SetProperty(c => c.TelemetryRecordingStopped, true));
            }
            Assert.Empty(await recorder.OnboardConnectedAsync(car.Id));
            recorder.OnSamples(car.Id, clock.GetUtcNow().UtcDateTime, [new RecordedSample(volt.Id, "2", TelemetrySampleState.Valid, 0, false)]);
            await Task.Delay(TimeSpan.FromSeconds(2));
            await using (var db = Db())
            {
                var stopped = await db.TelemetrySessions.SingleAsync(s => s.CarId == car.Id);
                Assert.NotNull(stopped.EndedAt);
                Assert.False(await db.TelemetrySamples.AnyAsync(s => s.SessionId == stopped.Id && s.Value == 2));
                await db.Cars.Where(c => c.Id == car.Id).ExecuteUpdateAsync(u => u.SetProperty(c => c.TelemetryRecordingStopped, false));
            }
            Assert.Equal(3, (await recorder.RefreshAsync(car.Id)).Count);
            recorder.OnboardDisconnected(car.Id);
            await Task.Delay(TimeSpan.FromSeconds(2));

            // Retention: a drive that ended before the cutoff goes, with its samples.
            await using (var db = Db())
            {
                var old = new TelemetrySession { CarId = car.Id, StartedAt = DateTime.UtcNow.AddDays(-3), EndedAt = DateTime.UtcNow.AddDays(-3).AddHours(1), LastSampleAt = DateTime.UtcNow.AddDays(-3) };
                db.TelemetrySessions.Add(old);
                await db.SaveChangesAsync();
                db.TelemetrySamples.Add(new TelemetryHistorySample { SessionId = old.Id, ChannelId = volt.Id, Time = old.StartedAt, Value = 1 });
                await db.SaveChangesAsync();
            }
            await recorder.ApplyRetentionAsync();
            await using (var db = Db())
            {
                Assert.Equal(session.Id, (await db.TelemetrySessions.SingleAsync(s => s.CarId == car.Id)).Id);
            }
        }
        finally
        {
            await cts.CancelAsync();
            await recorder.StopAsync(CancellationToken.None);
            await using var db = Db();
            await db.Cars.Where(c => c.Id == car.Id).ExecuteDeleteAsync();
        }
    }

    [SkippableFact]
    public async Task ChangedDataTypeTakesEffectWithoutReconnect()
    {
        Skip.If(string.IsNullOrEmpty(ConnectionString), $"{PostgresOverlayTestDb.Variable} not set");
        var services = new ServiceCollection()
            .AddDbContext<SignalRCContext>(o => o.UseNpgsql(ConnectionString))
            .BuildServiceProvider();
        SignalRCContext Db() => services.CreateScope().ServiceProvider.GetRequiredService<SignalRCContext>();

        await Db().Database.MigrateAsync();
        var car = new Car { Name = "history-type-test", CarIdentityKey = "history-" + Guid.NewGuid().ToString("N")[..12], LastSeen = DateTime.UtcNow };
        // Created with the default data type: a number arrives but is recorded as text.
        var cpu = new CarTelemetry { ChannelName = "cpuTemperature", DataType = TelemetryDataType.String, Record = true };
        await using (var db = Db())
        {
            db.Cars.Add(car);
            await db.SaveChangesAsync();
            cpu.CarId = car.Id;
            db.CarTelemetry.Add(cpu);
            await db.SaveChangesAsync();
        }

        var recorder = new TelemetryRecorder(services.GetRequiredService<IServiceScopeFactory>(), TimeProvider.System, NullLogger<TelemetryRecorder>.Instance);
        using var cts = new CancellationTokenSource();
        await recorder.StartAsync(cts.Token);
        try
        {
            await recorder.OnboardConnectedAsync(car.Id);
            recorder.OnSamples(car.Id, DateTime.UtcNow, [new RecordedSample(cpu.Id, "52.3", TelemetrySampleState.Valid, 0, false)]);
            await Task.Delay(TimeSpan.FromSeconds(2));

            // Switched to Number in the setup while the vehicle stays connected.
            await using (var db = Db())
            {
                await db.CarTelemetry.Where(t => t.Id == cpu.Id).ExecuteUpdateAsync(u => u.SetProperty(t => t.DataType, TelemetryDataType.Number));
            }
            await recorder.RefreshAsync(car.Id);
            recorder.OnSamples(car.Id, DateTime.UtcNow, [new RecordedSample(cpu.Id, "53.1", TelemetrySampleState.Valid, 0, false)]);
            await Task.Delay(TimeSpan.FromSeconds(2));

            await using (var db = Db())
            {
                var session = await db.TelemetrySessions.SingleAsync(s => s.CarId == car.Id);
                Assert.Equal(TelemetryDataType.Number, TelemetryRecorder.ReadChannels(session.ChannelsJson).Single().DataType);
                Assert.Equal(["52.3"], await db.TelemetryTextSamples.Where(s => s.SessionId == session.Id).Select(s => s.Value).ToListAsync());
                Assert.Contains(53.1, await db.TelemetrySamples.Where(s => s.SessionId == session.Id).Select(s => s.Value).ToListAsync());
            }
        }
        finally
        {
            await cts.CancelAsync();
            await recorder.StopAsync(CancellationToken.None);
            await using var db = Db();
            await db.Cars.Where(c => c.Id == car.Id).ExecuteDeleteAsync();
        }
    }

    /// <summary>The system clock moved by a fixed offset; timers run in real time.</summary>
    private sealed class ShiftedClock(TimeSpan offset) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => base.GetUtcNow() + offset;
    }
}

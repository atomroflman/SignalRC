using Microsoft.EntityFrameworkCore;
using Npgsql;
using SignalRC.Server.Data;

namespace SignalRC.Server.Telemetry.History;

/// <summary>Samples of one channel; null is a gap.</summary>
public sealed record ChannelSamples(List<long> T, List<double?> V);

/// <summary>Changes of one text channel; null is a gap.</summary>
public sealed record TextSamples(List<long> T, List<string?> V);

/// <param name="ResolutionMs">0 for raw samples, otherwise the bucket width.</param>
/// <param name="Texts">Changes of text channels, never reduced; the state at the start of the range comes first.</param>
public sealed record SamplesResult(long ResolutionMs, Dictionary<int, ChannelSamples> Channels, Dictionary<int, TextSamples> Texts);

/// <summary>Reads recorded samples (PostgreSQL only: raw SQL for the reduction).</summary>
public static class TelemetryHistoryReader
{
    public const int MaxRawRows = 200_000;
    public const int MaxTextRows = 20_000;

    /// <summary>
    /// Samples of a session between <paramref name="start"/> and <paramref name="end"/>
    /// (Unix ms, inclusive). With <paramref name="after"/> only the raw samples
    /// newer than it. Otherwise raw while that fits <paramref name="buckets"/>
    /// per channel, else the smallest and the largest value of each time bucket
    /// at their own times, so peaks survive; a bucket with only gaps yields null.
    /// </summary>
    public static async Task<SamplesResult> ReadSamplesAsync(SignalRCContext db, int sessionId, long start, long end, long? after, int buckets)
    {
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        var opened = connection.State != System.Data.ConnectionState.Open;
        if (opened) await connection.OpenAsync();
        try
        {
            var series = new Dictionary<int, ChannelSamples>();
            var texts = await ReadTextsAsync(connection, sessionId, after.HasValue ? after.Value + 1 : start, after.HasValue ? long.MaxValue / 2 : end, !after.HasValue);
            var fromTime = Utc(after.HasValue ? after.Value + 1 : start);
            var toTime = Utc(after.HasValue ? long.MaxValue / 2 : end);

            var count = 0L;
            var channels = 1L;
            if (!after.HasValue)
            {
                await using var c = new NpgsqlCommand(
                    "SELECT count(*), count(DISTINCT \"ChannelId\") FROM \"TelemetrySamples\" WHERE \"SessionId\" = @s AND \"Time\" BETWEEN @f AND @t", connection);
                c.Parameters.AddWithValue("s", sessionId);
                c.Parameters.AddWithValue("f", fromTime);
                c.Parameters.AddWithValue("t", toTime);
                await using var r = await c.ExecuteReaderAsync();
                if (await r.ReadAsync())
                {
                    count = r.GetInt64(0);
                    channels = Math.Max(1, r.GetInt64(1));
                }
            }

            if (after.HasValue || count <= buckets * channels)
            {
                await using var c = new NpgsqlCommand(
                    "SELECT \"ChannelId\", \"Time\", \"Value\" FROM \"TelemetrySamples\" WHERE \"SessionId\" = @s AND \"Time\" BETWEEN @f AND @t ORDER BY \"ChannelId\", \"Time\" LIMIT @l", connection);
                c.Parameters.AddWithValue("s", sessionId);
                c.Parameters.AddWithValue("f", fromTime);
                c.Parameters.AddWithValue("t", toTime);
                c.Parameters.AddWithValue("l", MaxRawRows);
                await using var r = await c.ExecuteReaderAsync();
                while (await r.ReadAsync())
                {
                    var v = r.GetDouble(2);
                    Add(series, r.GetInt32(0), Ms(r.GetDateTime(1)), double.IsNaN(v) ? null : v);
                }
                return new SamplesResult(0, series, texts);
            }

            var resolution = Math.Max(1, (end - start) / buckets);
            await using (var c = new NpgsqlCommand("""
                SELECT "ChannelId",
                       min("Time") AS t0,
                       min("Value") FILTER (WHERE "Value" <> 'NaN'::float8) AS mn,
                       max("Value") FILTER (WHERE "Value" <> 'NaN'::float8) AS mx,
                       (array_agg("Time" ORDER BY "Value") FILTER (WHERE "Value" <> 'NaN'::float8))[1] AS tmn,
                       (array_agg("Time" ORDER BY "Value" DESC) FILTER (WHERE "Value" <> 'NaN'::float8))[1] AS tmx
                FROM "TelemetrySamples"
                WHERE "SessionId" = @s AND "Time" BETWEEN @f AND @t
                GROUP BY "ChannelId", width_bucket(extract(epoch FROM "Time") * 1000, @fm, @tm, @n)
                ORDER BY "ChannelId", t0
                """, connection))
            {
                c.Parameters.AddWithValue("s", sessionId);
                c.Parameters.AddWithValue("f", fromTime);
                c.Parameters.AddWithValue("t", toTime);
                c.Parameters.AddWithValue("fm", (double)start);
                c.Parameters.AddWithValue("tm", (double)end + 1);
                c.Parameters.AddWithValue("n", buckets);
                await using var r = await c.ExecuteReaderAsync();
                while (await r.ReadAsync())
                {
                    var id = r.GetInt32(0);
                    if (r.IsDBNull(2))
                    {
                        Add(series, id, Ms(r.GetDateTime(1)), null);
                        continue;
                    }
                    var (mn, mx) = (r.GetDouble(2), r.GetDouble(3));
                    var (tmn, tmx) = (Ms(r.GetDateTime(4)), Ms(r.GetDateTime(5)));
                    if (tmn == tmx || mn == mx)
                    {
                        Add(series, id, Math.Min(tmn, tmx), mn == mx ? mn : (mn + mx) / 2);
                    }
                    else if (tmn < tmx)
                    {
                        Add(series, id, tmn, mn);
                        Add(series, id, tmx, mx);
                    }
                    else
                    {
                        Add(series, id, tmx, mx);
                        Add(series, id, tmn, mn);
                    }
                }
            }
            return new SamplesResult(resolution, series, texts);
        }
        finally
        {
            if (opened) await connection.CloseAsync();
        }
    }

    private static async Task<Dictionary<int, TextSamples>> ReadTextsAsync(NpgsqlConnection connection, int sessionId, long start, long end, bool withState)
    {
        var texts = new Dictionary<int, TextSamples>();
        // The state each channel had at the start, then the changes inside the range.
        var state = withState ? """
            (SELECT DISTINCT ON ("ChannelId") "ChannelId", "Time", "Value" FROM "TelemetryTextSamples"
             WHERE "SessionId" = @s AND "Time" < @f ORDER BY "ChannelId", "Time" DESC)
            UNION ALL
            """ : "";
        var sql = $"""
            SELECT * FROM (
            {state}
            (SELECT "ChannelId", "Time", "Value" FROM "TelemetryTextSamples"
             WHERE "SessionId" = @s AND "Time" BETWEEN @f AND @t ORDER BY "ChannelId", "Time" LIMIT @l)
            ) x ORDER BY 1, 2
            """;
        await using var c = new NpgsqlCommand(sql, connection);
        c.Parameters.AddWithValue("s", sessionId);
        c.Parameters.AddWithValue("f", Utc(start));
        c.Parameters.AddWithValue("t", Utc(end));
        c.Parameters.AddWithValue("l", MaxTextRows);
        await using var r = await c.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            var id = r.GetInt32(0);
            if (!texts.TryGetValue(id, out var x)) texts[id] = x = new([], []);
            x.T.Add(Ms(r.GetDateTime(1)));
            x.V.Add(r.IsDBNull(2) ? null : r.GetString(2));
        }
        return texts;
    }

    private static void Add(Dictionary<int, ChannelSamples> series, int id, long t, double? v)
    {
        if (!series.TryGetValue(id, out var s)) series[id] = s = new([], []);
        // Two rows of one channel in the same millisecond: keep the later value.
        if (s.T.Count > 0 && s.T[^1] >= t)
        {
            s.V[^1] = v;
            return;
        }
        s.T.Add(t);
        s.V.Add(v);
    }

    public static long Ms(DateTime utc) => new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
    public static DateTime Utc(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(Math.Clamp(ms, 0, 253402300799999)).UtcDateTime;
}

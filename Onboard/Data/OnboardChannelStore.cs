using System.Text.Json;
using LteCar.Shared.Channels;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Data;

// ponytail: raw SQLite instead of EF Core; one table per channel kind, primary key = dictionary key.
public sealed class OnboardChannelStore
{
    private readonly string _dbPath;
    private readonly ILogger<OnboardChannelStore> _logger;

    public OnboardChannelStore(string dbPath, ILogger<OnboardChannelStore> logger)
    {
        _dbPath = dbPath;
        _logger = logger;
    }

    private SqliteConnection Open()
    {
        var cs = new SqliteConnectionStringBuilder { DataSource = _dbPath, Mode = SqliteOpenMode.ReadWriteCreate }.ToString();
        var c = new SqliteConnection(cs);
        c.Open();
        using var pragma = c.CreateCommand();
        pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;";
        pragma.ExecuteNonQuery();
        return c;
    }

    public async Task InitializeAsync()
    {
        await using var c = Open();
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = Schema;
            await cmd.ExecuteNonQueryAsync();
        }
        await MigrateAsync(c);
        _logger.LogInformation("OnboardChannelStore schema ensured at {Path}", _dbPath);
    }

    private static async Task MigrateAsync(SqliteConnection c)
    {
        // Add missing columns that were introduced after the initial schema.
        // SQLite has no ALTER TABLE ADD COLUMN IF NOT EXISTS, so we check pragma first.
        var columns = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["control_channels"] = ["options_json", "server_id", "modified_at", "control_type", "test_disabled", "max_resend_interval"],
            ["telemetry_channels"] = ["options_json", "server_id", "modified_at", "read_interval_ticks", "telemetry_type", "data_type", "unit", "decimals"],
            ["video_streams"] = ["server_id", "modified_at", "camera_device", "rpi_cam_id", "width", "height", "framerate", "bitrate", "options_json"],
            ["pin_managers"] = ["type", "options_json"],
        };

        foreach (var (table, expectedColumns) in columns)
        {
            var existing = await GetColumnNamesAsync(c, table);
            foreach (var col in expectedColumns)
            {
                if (existing.Contains(col, StringComparer.OrdinalIgnoreCase))
                    continue;

                var defaultValue = col switch
                {
                    "options_json" => "DEFAULT '{}'",
                    "test_disabled" => "DEFAULT 0",
                    "enabled" => "DEFAULT 1",
                    "data_type" => "DEFAULT 0",
                    "read_interval_ticks" => "DEFAULT 0",
                    "decimals" => "DEFAULT 0",
                    "width" or "height" or "framerate" or "bitrate" or "rpi_cam_id" or "server_id" or "address" => "DEFAULT NULL",
                    _ => "DEFAULT NULL",
                };

                var nullable = col is "options_json" ? "NOT NULL" : ""; // options_json is NOT NULL in current schema
                if (col == "options_json")
                    nullable = "NOT NULL";

                var sql = $"ALTER TABLE {table} ADD COLUMN {col} TEXT {nullable} {defaultValue};";
                if (col is "address" or "server_id" or "rpi_cam_id" or "width" or "height" or "framerate" or "bitrate" or "read_interval_ticks" or "data_type" or "decimals" or "test_disabled" or "enabled")
                    sql = $"ALTER TABLE {table} ADD COLUMN {col} INTEGER {nullable} {defaultValue};";

                try
                {
                    await using var cmd = c.CreateCommand();
                    cmd.CommandText = sql;
                    await cmd.ExecuteNonQueryAsync();
                }
                catch (SqliteException ex) when (ex.SqliteErrorCode == 1)
                {
                    // SQL error 1 = generic error, often "duplicate column name" which is fine.
                }
            }
        }
    }

    private static async Task<HashSet<string>> GetColumnNamesAsync(SqliteConnection c, string table)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var cmd = c.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info({table});";
        await using var rd = await cmd.ExecuteReaderAsync();
        while (await rd.ReadAsync())
        {
            result.Add(rd.GetString(1));
        }
        return result;
    }

    public async Task<ChannelMap> LoadAsync()
    {
        var map = new ChannelMap();
        await using var c = Open();

        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT dict_key, name, pin_manager, address, options_json, server_id, modified_at, control_type, test_disabled, max_resend_interval FROM control_channels";
            await using var rd = await cmd.ExecuteReaderAsync();
            while (await rd.ReadAsync())
            {
                var item = new ControlChannelMapItem
                {
                    PinManager = rd.GetString(2),
                    Address = rd.IsDBNull(3) ? null : rd.GetInt32(3),
                    Options = JsonSerializer.Deserialize<Dictionary<string, object>>(rd.GetString(4)) ?? new(),
                    ServerId = rd.IsDBNull(5) ? null : rd.GetInt32(5),
                    ModifiedAt = ParseDate(rd, 6),
                    ControlType = rd.GetString(7),
                    TestDisabled = rd.GetBoolean(8),
                    MaxResendInterval = rd.IsDBNull(9) ? null : rd.GetInt32(9),
                };
                map.ControlChannels[rd.GetString(0)] = item;
            }
        }

        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT dict_key, name, pin_manager, address, options_json, server_id, modified_at, read_interval_ticks, telemetry_type, data_type, unit, decimals FROM telemetry_channels";
            await using var rd = await cmd.ExecuteReaderAsync();
            while (await rd.ReadAsync())
            {
                var item = new TelemetryChannelMapItem
                {
                    PinManager = rd.GetString(2),
                    Address = rd.IsDBNull(3) ? null : rd.GetInt32(3),
                    Options = JsonSerializer.Deserialize<Dictionary<string, object>>(rd.GetString(4)) ?? new(),
                    ServerId = rd.IsDBNull(5) ? null : rd.GetInt32(5),
                    ModifiedAt = ParseDate(rd, 6),
                    ReadIntervalTicks = rd.GetInt32(7),
                    TelemetryType = rd.GetString(8),
                    DataType = (TelemetryDataType)rd.GetInt32(9),
                    Unit = rd.IsDBNull(10) ? null : rd.GetString(10),
                    Decimals = rd.IsDBNull(11) ? null : rd.GetByte(11),
                };
                map.TelemetryChannels[rd.GetString(0)] = item;
            }
        }

        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT dict_key, stream_id, name, location, type, enabled, server_id, modified_at, camera_device, rpi_cam_id, width, height, framerate, bitrate, options_json FROM video_streams";
            await using var rd = await cmd.ExecuteReaderAsync();
            while (await rd.ReadAsync())
            {
                var item = new VideoStreamMapItem
                {
                    StreamId = rd.GetString(1),
                    Name = rd.IsDBNull(2) ? null : rd.GetString(2),
                    Location = rd.IsDBNull(3) ? null : rd.GetString(3),
                    Type = rd.IsDBNull(4) ? null : rd.GetString(4),
                    Enabled = rd.GetBoolean(5),
                    ServerId = rd.IsDBNull(6) ? null : rd.GetInt32(6),
                    ModifiedAt = ParseDate(rd, 7),
                    CameraDevice = rd.IsDBNull(8) ? null : rd.GetString(8),
                    RpiCamId = rd.IsDBNull(9) ? null : rd.GetInt32(9),
                    Width = rd.IsDBNull(10) ? null : rd.GetInt32(10),
                    Height = rd.IsDBNull(11) ? null : rd.GetInt32(11),
                    Framerate = rd.IsDBNull(12) ? null : rd.GetInt32(12),
                    Bitrate = rd.IsDBNull(13) ? null : rd.GetInt32(13),
                    Options = rd.IsDBNull(14) ? new() : JsonSerializer.Deserialize<Dictionary<string, object>>(rd.GetString(14)) ?? new(),
                };
                map.VideoStreams[rd.GetString(0)] = item;
            }
        }

        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT dict_key, type, options_json FROM pin_managers";
            await using var rd = await cmd.ExecuteReaderAsync();
            while (await rd.ReadAsync())
            {
                var item = new PinManagerMapItem
                {
                    Type = rd.IsDBNull(1) ? null : rd.GetString(1),
                    Options = JsonSerializer.Deserialize<Dictionary<string, object>>(rd.GetString(2)) ?? new(),
                };
                map.PinManagers[rd.GetString(0)] = item;
            }
        }

        return map;
    }

    public async Task UpsertControlChannelAsync(string dictKey, ControlChannelMapItem item)
    {
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO control_channels (dict_key, name, pin_manager, address, options_json, server_id, modified_at, control_type, test_disabled, max_resend_interval)
            VALUES ($k, $n, $pm, $addr, $opts, $sid, $mod, $ct, $td, $mri)
            ON CONFLICT(dict_key) DO UPDATE SET
                name=excluded.name,
                pin_manager=excluded.pin_manager,
                address=excluded.address,
                options_json=excluded.options_json,
                server_id=excluded.server_id,
                modified_at=excluded.modified_at,
                control_type=excluded.control_type,
                test_disabled=excluded.test_disabled,
                max_resend_interval=excluded.max_resend_interval;";
        cmd.Parameters.AddWithValue("$k", dictKey);
        cmd.Parameters.AddWithValue("$n", dictKey); // channel name == dictKey for the canonical setup
        cmd.Parameters.AddWithValue("$pm", item.PinManager);
        cmd.Parameters.AddWithValue("$addr", (object?)item.Address ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$opts", JsonSerializer.Serialize(item.Options));
        cmd.Parameters.AddWithValue("$sid", (object?)item.ServerId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$mod", FormatDate(item.ModifiedAt));
        cmd.Parameters.AddWithValue("$ct", item.ControlType);
        cmd.Parameters.AddWithValue("$td", item.TestDisabled);
        cmd.Parameters.AddWithValue("$mri", (object?)item.MaxResendInterval ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task UpsertTelemetryChannelAsync(string dictKey, TelemetryChannelMapItem item)
    {
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO telemetry_channels (dict_key, name, pin_manager, address, options_json, server_id, modified_at, read_interval_ticks, telemetry_type, data_type, unit, decimals)
            VALUES ($k, $n, $pm, $addr, $opts, $sid, $mod, $rit, $tt, $dt, $unit, $dec)
            ON CONFLICT(dict_key) DO UPDATE SET
                name=excluded.name,
                pin_manager=excluded.pin_manager,
                address=excluded.address,
                options_json=excluded.options_json,
                server_id=excluded.server_id,
                modified_at=excluded.modified_at,
                read_interval_ticks=excluded.read_interval_ticks,
                telemetry_type=excluded.telemetry_type,
                data_type=excluded.data_type,
                unit=excluded.unit,
                decimals=excluded.decimals;";
        cmd.Parameters.AddWithValue("$k", dictKey);
        cmd.Parameters.AddWithValue("$n", dictKey);
        cmd.Parameters.AddWithValue("$pm", item.PinManager);
        cmd.Parameters.AddWithValue("$addr", (object?)item.Address ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$opts", JsonSerializer.Serialize(item.Options));
        cmd.Parameters.AddWithValue("$sid", (object?)item.ServerId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$mod", FormatDate(item.ModifiedAt));
        cmd.Parameters.AddWithValue("$rit", item.ReadIntervalTicks);
        cmd.Parameters.AddWithValue("$tt", item.TelemetryType);
        cmd.Parameters.AddWithValue("$dt", (int)item.DataType);
        cmd.Parameters.AddWithValue("$unit", (object?)item.Unit ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$dec", (object?)item.Decimals ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task UpsertVideoStreamAsync(string dictKey, VideoStreamMapItem item)
    {
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO video_streams (dict_key, stream_id, name, location, type, enabled, server_id, modified_at, camera_device, rpi_cam_id, width, height, framerate, bitrate, options_json)
            VALUES ($k, $sid, $n, $loc, $t, $en, $svid, $mod, $cam, $rcid, $w, $h, $fps, $br, $opts)
            ON CONFLICT(dict_key) DO UPDATE SET
                stream_id=excluded.stream_id,
                name=excluded.name,
                location=excluded.location,
                type=excluded.type,
                enabled=excluded.enabled,
                server_id=excluded.server_id,
                modified_at=excluded.modified_at,
                camera_device=excluded.camera_device,
                rpi_cam_id=excluded.rpi_cam_id,
                width=excluded.width,
                height=excluded.height,
                framerate=excluded.framerate,
                bitrate=excluded.bitrate,
                options_json=excluded.options_json;";
        cmd.Parameters.AddWithValue("$k", dictKey);
        cmd.Parameters.AddWithValue("$sid", item.StreamId);
        cmd.Parameters.AddWithValue("$n", (object?)item.Name ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$loc", (object?)item.Location ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$t", (object?)item.Type ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$en", item.Enabled);
        cmd.Parameters.AddWithValue("$svid", (object?)item.ServerId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$mod", FormatDate(item.ModifiedAt));
        cmd.Parameters.AddWithValue("$cam", (object?)item.CameraDevice ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$rcid", (object?)item.RpiCamId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$w", (object?)item.Width ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$h", (object?)item.Height ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$fps", (object?)item.Framerate ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$br", (object?)item.Bitrate ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$opts", JsonSerializer.Serialize(item.Options));
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task DeleteControlChannelAsync(string dictKey)
    {
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "DELETE FROM control_channels WHERE dict_key = $k";
        cmd.Parameters.AddWithValue("$k", dictKey);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task DeleteTelemetryChannelAsync(string dictKey)
    {
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "DELETE FROM telemetry_channels WHERE dict_key = $k";
        cmd.Parameters.AddWithValue("$k", dictKey);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task DeleteVideoStreamAsync(string dictKey)
    {
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "DELETE FROM video_streams WHERE dict_key = $k";
        cmd.Parameters.AddWithValue("$k", dictKey);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task ReplaceAllAsync(ChannelMap map)
    {
        await using var c = Open();
        await using var tx = c.BeginTransaction();
        await ExecAsync(c, tx, "DELETE FROM control_channels");
        await ExecAsync(c, tx, "DELETE FROM telemetry_channels");
        await ExecAsync(c, tx, "DELETE FROM video_streams");
        await ExecAsync(c, tx, "DELETE FROM pin_managers");
        foreach (var (k, v) in map.ControlChannels) await UpsertAsync(c, tx, k, v);
        foreach (var (k, v) in map.TelemetryChannels) await UpsertAsync(c, tx, k, v);
        foreach (var (k, v) in map.VideoStreams) await UpsertAsync(c, tx, k, v);
        foreach (var (k, v) in map.PinManagers) await UpsertAsync(c, tx, k, v);
        tx.Commit();
    }

    private static async Task UpsertAsync(SqliteConnection c, SqliteTransaction tx, string dictKey, ControlChannelMapItem item)
    {
        await using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = @"
            INSERT INTO control_channels (dict_key, name, pin_manager, address, options_json, server_id, modified_at, control_type, test_disabled, max_resend_interval)
            VALUES ($k, $n, $pm, $addr, $opts, $sid, $mod, $ct, $td, $mri)
            ON CONFLICT(dict_key) DO UPDATE SET
                name=excluded.name, pin_manager=excluded.pin_manager, address=excluded.address,
                options_json=excluded.options_json, server_id=excluded.server_id, modified_at=excluded.modified_at,
                control_type=excluded.control_type, test_disabled=excluded.test_disabled, max_resend_interval=excluded.max_resend_interval;";
        cmd.Parameters.AddWithValue("$k", dictKey);
        cmd.Parameters.AddWithValue("$n", dictKey);
        cmd.Parameters.AddWithValue("$pm", item.PinManager);
        cmd.Parameters.AddWithValue("$addr", (object?)item.Address ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$opts", JsonSerializer.Serialize(item.Options));
        cmd.Parameters.AddWithValue("$sid", (object?)item.ServerId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$mod", FormatDate(item.ModifiedAt));
        cmd.Parameters.AddWithValue("$ct", item.ControlType);
        cmd.Parameters.AddWithValue("$td", item.TestDisabled);
        cmd.Parameters.AddWithValue("$mri", (object?)item.MaxResendInterval ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task UpsertAsync(SqliteConnection c, SqliteTransaction tx, string dictKey, TelemetryChannelMapItem item)
    {
        await using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = @"
            INSERT INTO telemetry_channels (dict_key, name, pin_manager, address, options_json, server_id, modified_at, read_interval_ticks, telemetry_type, data_type, unit, decimals)
            VALUES ($k, $n, $pm, $addr, $opts, $sid, $mod, $rit, $tt, $dt, $unit, $dec)
            ON CONFLICT(dict_key) DO UPDATE SET
                name=excluded.name, pin_manager=excluded.pin_manager, address=excluded.address,
                options_json=excluded.options_json, server_id=excluded.server_id, modified_at=excluded.modified_at,
                read_interval_ticks=excluded.read_interval_ticks, telemetry_type=excluded.telemetry_type,
                data_type=excluded.data_type, unit=excluded.unit, decimals=excluded.decimals;";
        cmd.Parameters.AddWithValue("$k", dictKey);
        cmd.Parameters.AddWithValue("$n", dictKey);
        cmd.Parameters.AddWithValue("$pm", item.PinManager);
        cmd.Parameters.AddWithValue("$addr", (object?)item.Address ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$opts", JsonSerializer.Serialize(item.Options));
        cmd.Parameters.AddWithValue("$sid", (object?)item.ServerId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$mod", FormatDate(item.ModifiedAt));
        cmd.Parameters.AddWithValue("$rit", item.ReadIntervalTicks);
        cmd.Parameters.AddWithValue("$tt", item.TelemetryType);
        cmd.Parameters.AddWithValue("$dt", (int)item.DataType);
        cmd.Parameters.AddWithValue("$unit", (object?)item.Unit ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$dec", (object?)item.Decimals ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task UpsertAsync(SqliteConnection c, SqliteTransaction tx, string dictKey, VideoStreamMapItem item)
    {
        await using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = @"
            INSERT INTO video_streams (dict_key, stream_id, name, location, type, enabled, server_id, modified_at, camera_device, rpi_cam_id, width, height, framerate, bitrate, options_json)
            VALUES ($k, $sid, $name, $loc, $type, $en, $svr, $mod, $cam, $rpi, $w, $h, $fps, $br, $opts)
            ON CONFLICT(dict_key) DO UPDATE SET
                stream_id=excluded.stream_id, name=excluded.name, location=excluded.location,
                type=excluded.type, enabled=excluded.enabled, server_id=excluded.server_id,
                modified_at=excluded.modified_at, camera_device=excluded.camera_device,
                rpi_cam_id=excluded.rpi_cam_id, width=excluded.width, height=excluded.height,
                framerate=excluded.framerate, bitrate=excluded.bitrate, options_json=excluded.options_json;";
        cmd.Parameters.AddWithValue("$k", dictKey);
        cmd.Parameters.AddWithValue("$sid", item.StreamId);
        cmd.Parameters.AddWithValue("$name", (object?)item.Name ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$loc", (object?)item.Location ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$type", (object?)item.Type ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$en", item.Enabled);
        cmd.Parameters.AddWithValue("$svr", (object?)item.ServerId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$mod", FormatDate(item.ModifiedAt));
        cmd.Parameters.AddWithValue("$cam", (object?)item.CameraDevice ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$rpi", (object?)item.RpiCamId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$w", (object?)item.Width ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$h", (object?)item.Height ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$fps", (object?)item.Framerate ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$br", (object?)item.Bitrate ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$opts", JsonSerializer.Serialize(item.Options));
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task UpsertAsync(SqliteConnection c, SqliteTransaction tx, string dictKey, PinManagerMapItem item)
    {
        await using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = @"
            INSERT INTO pin_managers (dict_key, type, options_json)
            VALUES ($k, $t, $opts)
            ON CONFLICT(dict_key) DO UPDATE SET
                type=excluded.type, options_json=excluded.options_json;";
        cmd.Parameters.AddWithValue("$k", dictKey);
        cmd.Parameters.AddWithValue("$t", (object?)item.Type ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$opts", JsonSerializer.Serialize(item.Options));
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task ExecAsync(SqliteConnection c, SqliteTransaction tx, string sql)
    {
        await using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }

    private static string FormatDate(DateTime? dt) => dt.HasValue ? dt.Value.ToUniversalTime().ToString("O") : "";

    private static DateTime? ParseDate(SqliteDataReader rd, int ordinal)
    {
        if (rd.IsDBNull(ordinal)) return null;
        var s = rd.GetString(ordinal);
        return string.IsNullOrEmpty(s) ? null : DateTime.Parse(s, null, System.Globalization.DateTimeStyles.RoundtripKind);
    }

    private const string Schema = @"
        CREATE TABLE IF NOT EXISTS control_channels (
            dict_key TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            pin_manager TEXT NOT NULL,
            address INTEGER,
            options_json TEXT NOT NULL,
            server_id INTEGER,
            modified_at TEXT,
            control_type TEXT NOT NULL,
            test_disabled INTEGER NOT NULL,
            max_resend_interval INTEGER
        );
        CREATE TABLE IF NOT EXISTS telemetry_channels (
            dict_key TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            pin_manager TEXT NOT NULL,
            address INTEGER,
            options_json TEXT NOT NULL,
            server_id INTEGER,
            modified_at TEXT,
            read_interval_ticks INTEGER NOT NULL,
            telemetry_type TEXT NOT NULL,
            data_type INTEGER NOT NULL,
            unit TEXT,
            decimals INTEGER
        );
        CREATE TABLE IF NOT EXISTS video_streams (
            dict_key TEXT PRIMARY KEY,
            stream_id TEXT NOT NULL,
            name TEXT,
            location TEXT,
            type TEXT,
            enabled INTEGER NOT NULL,
            server_id INTEGER,
            modified_at TEXT,
            camera_device TEXT,
            rpi_cam_id INTEGER,
            width INTEGER,
            height INTEGER,
            framerate INTEGER,
            bitrate INTEGER,
            options_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS pin_managers (
            dict_key TEXT PRIMARY KEY,
            type TEXT,
            options_json TEXT NOT NULL
        );";
}
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;

namespace SignalRC.Overlay.Tests.Overlay;

/// <summary>A database the overlay service tests run against.</summary>
public interface IOverlayTestDb : IDisposable
{
    SignalRCContext Create();
    /// <summary>Whether separate contexts may be used concurrently.</summary>
    bool SupportsConcurrency { get; }
}

/// <summary>SignalRCContext on in-memory SQLite; the real schema without Postgres.</summary>
public sealed class SqliteOverlayTestDb : IOverlayTestDb
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public SqliteOverlayTestDb()
    {
        _connection.Open();
        using var db = Create();
        db.Database.EnsureCreated();
    }

    public bool SupportsConcurrency => false;

    public SignalRCContext Create() =>
        new SqliteContext(new DbContextOptionsBuilder<SignalRCContext>().UseSqlite(_connection).Options);

    public void Dispose() => _connection.Dispose();

    /// <summary>SQLite has no sequences; the user session sequence is not needed here.</summary>
    private sealed class SqliteContext(DbContextOptions<SignalRCContext> options) : SignalRCContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.Model.RemoveSequence("UserSessionSeq");
        }
    }
}

/// <summary>
/// An existing, migrated PostgreSQL test database named by the environment
/// variable SIGNALRC_TEST_POSTGRES (a connection string). Tests create their
/// own vehicle and users and remove them afterwards.
/// </summary>
public sealed class PostgresOverlayTestDb(string connectionString) : IOverlayTestDb
{
    public const string Variable = "SIGNALRC_TEST_POSTGRES";

    public static PostgresOverlayTestDb? FromEnvironment() =>
        Environment.GetEnvironmentVariable(Variable) is { Length: > 0 } cs ? new PostgresOverlayTestDb(cs) : null;

    public bool SupportsConcurrency => true;

    public SignalRCContext Create() =>
        new(new DbContextOptionsBuilder<SignalRCContext>().UseNpgsql(connectionString).Options);

    public void Dispose() { }
}

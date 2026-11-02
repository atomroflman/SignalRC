using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;

namespace SignalRC.Overlay.Tests.Overlay;

/// <summary>SignalRCContext on in-memory SQLite; the real schema without Postgres.</summary>
public sealed class OverlayTestDb : IDisposable
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    public OverlayTestDb()
    {
        _connection.Open();
        using var db = Create();
        db.Database.EnsureCreated();
    }

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

using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Data;
using System.Reflection;

namespace LteCar.Server.Data
{
    public class LteCarContext : DbContext
    {
        public LteCarContext(DbContextOptions<LteCarContext> options) : base(options) { }

        public DbSet<Car> Cars { get; set; }
        public DbSet<User> Users { get; set; }
        public DbSet<CarChannel> CarChannels { get; set; }
        public DbSet<CarTelemetry> CarTelemetry { get; set; }
        public DbSet<CarVideoStream> CarVideoStreams { get; set; }
        public DbSet<CarPinManager> CarPinManagers { get; set; }
        public DbSet<ChannelTemplate> ChannelTemplates { get; set; }
        public DbSet<UserCarSetup> UserSetups { get; set; }
        public DbSet<UserSetupTelemetry> UserSetupTelemetries { get; set; }
        public DbSet<SetupFilterType> SetupFilterTypes { get; set; }
        public DbSet<FileTransfer> FileTransfers { get; set; }

        public async Task<long> GetNextUserSessionId() 
        {
            var connection = Database.GetDbConnection();
            var wasClosed = connection.State == ConnectionState.Closed;
            if (wasClosed)
            {
                await connection.OpenAsync();
            }

            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT nextval('\"UserSessionSeq\"')";

            var result = await command.ExecuteScalarAsync();

            if (wasClosed)
            {
                await connection.CloseAsync();
            }

            return Convert.ToInt64(result);
        }

        public class Test
        {
            public long Id { get; set; }
        }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            // Use all IEntityTypeConfiguration classes in this assembly
            modelBuilder.ApplyConfigurationsFromAssembly(Assembly.GetExecutingAssembly());
            modelBuilder.HasSequence<long>("UserSessionSeq")
                .StartsAt(1)
                .IncrementsBy(1);
        }
    }
}
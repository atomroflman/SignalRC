using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace SignalRC.Server.Data;

public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<SignalRCContext>
{
    public SignalRCContext CreateDbContext(string[] args)
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appSettings.json")
            .Build();

        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? "Host=localhost;Database=signalrc;Username=signalrc;Password=signalrc";

        var optionsBuilder = new DbContextOptionsBuilder<SignalRCContext>();
        optionsBuilder.UseNpgsql(connectionString);

        return new SignalRCContext(optionsBuilder.Options);
    }
}

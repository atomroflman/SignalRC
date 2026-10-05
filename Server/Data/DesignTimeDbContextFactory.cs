using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace LteCar.Server.Data;

public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<LteCarContext>
{
    public LteCarContext CreateDbContext(string[] args)
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appSettings.json")
            .Build();

        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? "Host=localhost;Database=ltecar;Username=ltecar;Password=ltecar";

        var optionsBuilder = new DbContextOptionsBuilder<LteCarContext>();
        optionsBuilder.UseNpgsql(connectionString);

        return new LteCarContext(optionsBuilder.Options);
    }
}

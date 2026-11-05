using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class TelemetrySessionMapping : IEntityTypeConfiguration<TelemetrySession>
{
    public void Configure(EntityTypeBuilder<TelemetrySession> builder)
    {
        builder.ToTable("TelemetrySessions");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.ChannelsJson).IsRequired();

        builder.HasOne(x => x.Car)
            .WithMany()
            .HasForeignKey(x => x.CarId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => new { x.CarId, x.StartedAt });
    }
}

public class TelemetryHistorySampleMapping : IEntityTypeConfiguration<TelemetryHistorySample>
{
    public void Configure(EntityTypeBuilder<TelemetryHistorySample> builder)
    {
        builder.ToTable("TelemetrySamples");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).UseIdentityAlwaysColumn();

        // Deleting a session (retention) removes its samples in the database.
        builder.HasOne(x => x.Session)
            .WithMany(s => s.Samples)
            .HasForeignKey(x => x.SessionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => new { x.SessionId, x.ChannelId, x.Time });
    }
}

public class CarTelemetryDashboardMapping : IEntityTypeConfiguration<CarTelemetryDashboard>
{
    public void Configure(EntityTypeBuilder<CarTelemetryDashboard> builder)
    {
        builder.ToTable("CarTelemetryDashboards");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.LayoutJson).IsRequired();

        builder.HasOne(x => x.Car)
            .WithMany()
            .HasForeignKey(x => x.CarId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => x.CarId).IsUnique();
    }
}

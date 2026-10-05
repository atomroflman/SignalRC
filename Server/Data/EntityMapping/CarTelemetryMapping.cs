using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LteCar.Server.Data.EntityMapping;

public class CarTelemetryMapping : IEntityTypeConfiguration<CarTelemetry>
{
    public void Configure(EntityTypeBuilder<CarTelemetry> builder)
    {
        builder.ToTable("CarTelemetry");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.ChannelName)
            .IsRequired()
            .HasMaxLength(64);

        builder.Property(x => x.TelemetryType)
            .IsRequired()
            .HasMaxLength(64);

        builder.Property(x => x.PinManager)
            .IsRequired()
            .HasMaxLength(64);

        builder.Property(x => x.Unit)
            .HasMaxLength(32);

        builder.HasIndex(x => new { x.CarId, x.ChannelName })
            .IsUnique();
    }
}

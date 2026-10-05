using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LteCar.Server.Data.EntityMapping;

public class CarPinManagerMapping : IEntityTypeConfiguration<CarPinManager>
{
    public void Configure(EntityTypeBuilder<CarPinManager> builder)
    {
        builder.ToTable("CarPinManagers");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(64);

        builder.Property(x => x.Type)
            .IsRequired()
            .HasMaxLength(64);

        builder.HasOne(x => x.Car)
            .WithMany(c => c.PinManagers)
            .HasForeignKey(x => x.CarId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => new { x.CarId, x.Name })
            .IsUnique();
    }
}

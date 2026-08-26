using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class CarMapping : IEntityTypeConfiguration<Car>
{
    public void Configure(EntityTypeBuilder<Car> builder)
    {
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Name).HasMaxLength(64);
        builder.Property(x => x.CarIdentityKey).HasMaxLength(64).IsRequired();
        builder.HasIndex(x => x.CarIdentityKey).IsUnique();
        builder.Property(x => x.ChannelMapHash).HasMaxLength(64);
        builder.HasMany(v => v.Functions)
            .WithOne(f => f.Car)
            .HasForeignKey(f => f.CarId)
            .OnDelete(DeleteBehavior.ClientCascade);
    }
}

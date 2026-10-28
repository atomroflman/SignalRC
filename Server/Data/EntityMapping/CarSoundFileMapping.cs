using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class CarSoundFileMapping : IEntityTypeConfiguration<CarSoundFile>
{
    public void Configure(EntityTypeBuilder<CarSoundFile> builder)
    {
        builder.HasKey(x => x.Id);

        builder.Property(x => x.FileName).HasMaxLength(100).IsRequired();
        builder.Property(x => x.ContentType).HasMaxLength(128);
        builder.Property(x => x.Sha256).HasMaxLength(64).IsRequired();
        builder.Property(x => x.Data).IsRequired();

        builder.HasOne(x => x.Car)
            .WithMany()
            .HasForeignKey(x => x.CarId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(x => new { x.CarId, x.FileName }).IsUnique();
    }
}

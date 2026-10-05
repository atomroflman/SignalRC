using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LteCar.Server.Data.EntityMapping;

public class CarVideoStreamMapping : IEntityTypeConfiguration<CarVideoStream>
{
    public void Configure(EntityTypeBuilder<CarVideoStream> builder)
    {
        builder.ToTable("CarVideoStreams");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.StreamId)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(x => x.Protocol)
            .IsRequired()
            .HasMaxLength(10);

        builder.Property(x => x.Port)
            .IsRequired();

        builder.Property(x => x.StartTime)
            .IsRequired();

        builder.Property(x => x.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.Property(x => x.ProcessArguments)
            .HasMaxLength(500);

        builder.Property(x => x.StreamPurpose)
            .HasMaxLength(100);
        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(100);
        builder.Property(x => x.Description)
            .HasMaxLength(500);
        builder.Property(x => x.Width)
            .IsRequired();
        builder.Property(x => x.Height)
            .IsRequired();
        builder.Property(x => x.Bitrate)    
            .IsRequired();
        builder.Property(x => x.Framerate)
            .IsRequired();

        // Foreign Key zu Car
        builder.HasOne(x => x.Car)
            .WithMany(c => c.VideoStreams)
            .HasForeignKey(x => x.CarId)
            .OnDelete(DeleteBehavior.Cascade);

        // Stream needs to be unique per Car
        builder.HasIndex(x => new { x.CarId, x.StreamId })
            .IsUnique();
        
        builder.HasIndex(x => x.Port);
    }
}
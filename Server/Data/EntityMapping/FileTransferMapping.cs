using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LteCar.Server.Data.EntityMapping;

public class FileTransferMapping : IEntityTypeConfiguration<FileTransfer>
{
    public void Configure(EntityTypeBuilder<FileTransfer> builder)
    {
        builder.HasKey(x => x.Id);

        builder.Property(x => x.FileName).HasMaxLength(256).IsRequired();
        builder.Property(x => x.ContentType).HasMaxLength(128);
        builder.Property(x => x.Sha256Hash).HasMaxLength(64).IsRequired();
        builder.Property(x => x.StoragePath).HasMaxLength(512).IsRequired();
        builder.Property(x => x.TargetPath).HasMaxLength(512);
        builder.Property(x => x.DownloadToken).HasMaxLength(32).IsRequired();
        builder.HasIndex(x => x.DownloadToken).IsUnique();

        builder.Property(x => x.Status)
            .HasConversion<string>()
            .HasMaxLength(32);

        builder.HasOne(x => x.Car)
            .WithMany()
            .HasForeignKey(x => x.CarId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.UploadedByUser)
            .WithMany()
            .HasForeignKey(x => x.UploadedByUserId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasIndex(x => new { x.CarId, x.Status });
    }
}

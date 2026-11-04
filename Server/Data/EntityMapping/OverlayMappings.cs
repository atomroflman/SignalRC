using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class OverlayDraftMapping : IEntityTypeConfiguration<OverlayDraft>
{
    public void Configure(EntityTypeBuilder<OverlayDraft> builder)
    {
        builder.ToTable("OverlayDrafts");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.DocumentJson).IsRequired();
        builder.HasIndex(x => x.CarId).IsUnique();
        builder.HasOne(x => x.Car).WithMany().HasForeignKey(x => x.CarId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class OverlayDraftRevisionMapping : IEntityTypeConfiguration<OverlayDraftRevision>
{
    public void Configure(EntityTypeBuilder<OverlayDraftRevision> builder)
    {
        builder.ToTable("OverlayDraftRevisions");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.DocumentJson).IsRequired();
        builder.HasIndex(x => new { x.CarId, x.Revision }).IsUnique();
        builder.HasOne<Car>().WithMany().HasForeignKey(x => x.CarId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class OverlayPublicationMapping : IEntityTypeConfiguration<OverlayPublication>
{
    public void Configure(EntityTypeBuilder<OverlayPublication> builder)
    {
        builder.ToTable("OverlayPublications");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.DocumentJson).IsRequired();
        builder.Property(x => x.Note).HasMaxLength(500);
        builder.Property(x => x.PublishedByName).HasMaxLength(100);
        builder.HasIndex(x => new { x.CarId, x.Number }).IsUnique();
        builder.HasOne(x => x.Car).WithMany().HasForeignKey(x => x.CarId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class OverlayPublicationAssetMapping : IEntityTypeConfiguration<OverlayPublicationAsset>
{
    public void Configure(EntityTypeBuilder<OverlayPublicationAsset> builder)
    {
        builder.ToTable("OverlayPublicationAssets");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.AssetId).IsRequired().HasMaxLength(71);
        builder.HasIndex(x => new { x.PublicationId, x.AssetId }).IsUnique();
        builder.HasOne(x => x.Publication).WithMany(x => x.Assets).HasForeignKey(x => x.PublicationId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class OverlayAssetMapping : IEntityTypeConfiguration<OverlayAsset>
{
    public void Configure(EntityTypeBuilder<OverlayAsset> builder)
    {
        builder.ToTable("OverlayAssets");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.AssetId).IsRequired().HasMaxLength(71);
        builder.Property(x => x.Svg).IsRequired();
        builder.Property(x => x.MetadataJson).IsRequired();
        builder.HasIndex(x => new { x.CarId, x.AssetId }).IsUnique();
        builder.HasOne(x => x.Car).WithMany().HasForeignKey(x => x.CarId).OnDelete(DeleteBehavior.Cascade);
    }
}

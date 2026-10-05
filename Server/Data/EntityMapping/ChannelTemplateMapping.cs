using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LteCar.Server.Data.EntityMapping;

public class ChannelTemplateMapping : IEntityTypeConfiguration<ChannelTemplate>
{
    public void Configure(EntityTypeBuilder<ChannelTemplate> builder)
    {
        builder.ToTable("ChannelTemplates");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Key)
            .IsRequired()
            .HasMaxLength(64);

        builder.HasIndex(x => x.Key)
            .IsUnique();

        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(x => x.Description)
            .HasMaxLength(500);

        builder.Property(x => x.Version)
            .HasMaxLength(32);

        builder.Property(x => x.Author)
            .HasMaxLength(100);

        builder.Property(x => x.ChannelMapJson)
            .IsRequired();

        builder.Property(x => x.ChannelMapHash)
            .IsRequired()
            .HasMaxLength(64);
    }
}

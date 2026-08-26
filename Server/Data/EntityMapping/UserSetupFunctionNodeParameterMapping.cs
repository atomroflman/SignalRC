

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class UserSetupFunctionNodeParameterMapping : IEntityTypeConfiguration<UserSetupFunctionNodeParameter>
{
    public void Configure(EntityTypeBuilder<UserSetupFunctionNodeParameter> builder)
    {
        builder.HasKey(x => x.Id);

        builder.HasOne(x => x.Node)
            .WithMany(x => x.Parameters)
            .HasForeignKey(x => x.NodeId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(x => new { x.NodeId, x.ParameterName })
            .IsUnique();

        builder.Property(x => x.ParameterName)
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(x => x.ParameterValue)
            .HasMaxLength(500);
    }
}
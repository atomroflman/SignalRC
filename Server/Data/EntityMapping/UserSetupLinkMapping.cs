using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LteCar.Server.Data.EntityMapping;

public class UserSetupLinkMapping : IEntityTypeConfiguration<UserSetupLink>
{
    public void Configure(EntityTypeBuilder<UserSetupLink> builder)
    {
        builder.HasKey(x => x.Id);
        builder.HasOne(l => l.UserSetupFromNode)
            .WithMany()
            .HasForeignKey(l => l.UserSetupFromNodeId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(l => l.UserSetupToNode)
            .WithMany()
            .HasForeignKey(l => l.UserSetupToNodeId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public class UserSetupTelemetryNodeMapping : IEntityTypeConfiguration<UserSetupTelemetryNode>
{
    public void Configure(EntityTypeBuilder<UserSetupTelemetryNode> builder)
    {
        builder.HasOne(n => n.UserSetup)
            .WithMany(s => s.TelemetryNodes)
            .HasForeignKey(n => n.UserSetupId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

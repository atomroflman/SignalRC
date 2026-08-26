using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class UserSetupCarChannelNodeMapping : IEntityTypeConfiguration<UserSetupCarChannelNode>
{
    public void Configure(EntityTypeBuilder<UserSetupCarChannelNode> builder)
    {
        builder.HasOne(f => f.CarChannel)
            .WithMany(v => v.SetupNodes)
            .HasForeignKey(f => f.CarChannelId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

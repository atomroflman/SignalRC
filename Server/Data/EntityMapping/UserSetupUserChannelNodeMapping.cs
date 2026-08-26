using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class UserSetupUserChannelNodeMapping : IEntityTypeConfiguration<UserSetupUserChannelNode>
{
    public void Configure(EntityTypeBuilder<UserSetupUserChannelNode> builder)
    {
        builder.HasOne(f => f.UserChannel)
            .WithMany(v => v.SetupNodes)
            .HasForeignKey(f => f.UserChannelId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

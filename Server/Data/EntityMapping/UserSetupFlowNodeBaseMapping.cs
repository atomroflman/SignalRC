using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class UserSetupFlowNodeBaseMapping : IEntityTypeConfiguration<UserSetupFlowNodeBase>
{
    public void Configure(EntityTypeBuilder<UserSetupFlowNodeBase> builder)
    {
        builder.ToTable("UserSetupFlowNodes");
        builder.HasDiscriminator<string>("NodeType")
            .HasValue<UserSetupCarChannelNode>("C")
            .HasValue<UserSetupFunctionNode>("F")
            .HasValue<UserSetupUserChannelNode>("U");
    }
}

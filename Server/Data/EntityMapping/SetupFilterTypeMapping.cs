using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class SetupFilterTypeMapping : IEntityTypeConfiguration<SetupFilterType>
{
    public void Configure(EntityTypeBuilder<SetupFilterType> builder)
    {
        builder.HasKey(x => x.Id);
    }
}

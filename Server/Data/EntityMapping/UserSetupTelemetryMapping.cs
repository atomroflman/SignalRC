using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class UserSetupTelemetryMapping : IEntityTypeConfiguration<UserSetupTelemetry>
{
    public void Configure(EntityTypeBuilder<UserSetupTelemetry> builder)
    {
    }
}

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class UserChannelDeviceMapping : IEntityTypeConfiguration<UserChannelDevice>
{
    public void Configure(EntityTypeBuilder<UserChannelDevice> builder)
    {
        builder.HasKey(x => x.Id);
        builder.Property(x => x.DeviceName).HasMaxLength(512);
        builder.HasOne(d => d.User)
            .WithMany(u => u.UserChannelDevices)
            .HasForeignKey(d => d.UserId)
            .OnDelete(DeleteBehavior.ClientCascade);
        builder.HasMany(d => d.Channels)
            .WithOne(c => c.UserChannelDevice)
            .HasForeignKey(c => c.UserChannelDeviceId)
            .OnDelete(DeleteBehavior.ClientCascade);
        builder.HasIndex(d => new { d.UserId, d.DeviceName }).IsUnique();
    }
}

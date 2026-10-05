using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace LteCar.Server.Data.EntityMapping;

public class UserMapping : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.HasKey(x => x.Id);
        builder.HasIndex(u => u.SessionId).IsUnique();
        builder.Property(u => u.Name).HasMaxLength(64);
        builder.Property(u => u.SessionId);
        builder.Property(u => u.TransferCode).HasMaxLength(6);
        builder.Property(u => u.TransferCodeExpiresAt);
        builder.HasIndex(u => u.TransferCode).IsUnique();
        builder.Property(u => u.RecoveryKeyHash).HasMaxLength(64);
        builder.Property(u => u.RecoveryKeyCreatedAt);
        builder.HasIndex(u => u.RecoveryKeyHash).IsUnique();
    }
}

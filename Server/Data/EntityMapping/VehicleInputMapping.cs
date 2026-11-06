using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class VehicleInputDeviceMapping : IEntityTypeConfiguration<VehicleInputDevice>
{
    public void Configure(EntityTypeBuilder<VehicleInputDevice> builder)
    {
        builder.ToTable("VehicleInputDevices");
        builder.HasKey(x => x.Id);
        builder.HasOne(d => d.Car)
            .WithMany()
            .HasForeignKey(d => d.CarId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(d => d.Channels)
            .WithOne(c => c.VehicleInputDevice)
            .HasForeignKey(c => c.VehicleInputDeviceId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(d => new { d.CarId, d.DeviceKey }).IsUnique();
    }
}

public class VehicleInputChannelMapping : IEntityTypeConfiguration<VehicleInputChannel>
{
    public void Configure(EntityTypeBuilder<VehicleInputChannel> builder)
    {
        builder.ToTable("VehicleInputChannels");
        builder.HasKey(x => x.Id);
        builder.HasIndex(c => new { c.VehicleInputDeviceId, c.IsAxis, c.Code }).IsUnique();
    }
}

public class UserSetupVehicleInputNodeMapping : IEntityTypeConfiguration<UserSetupVehicleInputNode>
{
    public void Configure(EntityTypeBuilder<UserSetupVehicleInputNode> builder)
    {
        builder.HasOne(n => n.VehicleInputChannel)
            .WithMany(c => c.SetupNodes)
            .HasForeignKey(n => n.VehicleInputChannelId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public class UserSetupHandoffNodeMapping : IEntityTypeConfiguration<UserSetupHandoffNode>
{
    public void Configure(EntityTypeBuilder<UserSetupHandoffNode> builder)
    {
        builder.Property(n => n.Name).HasMaxLength(64);
    }
}

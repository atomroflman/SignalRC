using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace SignalRC.Server.Data.EntityMapping;

public class CarChannelMapping : IEntityTypeConfiguration<CarChannel>
{
    public void Configure(EntityTypeBuilder<CarChannel> builder)
    {
        builder.HasKey(x => x.Id);
        builder.HasOne(f => f.Car)
            .WithMany(v => v.Functions)
            .HasForeignKey(f => f.CarId)
            .OnDelete(DeleteBehavior.ClientCascade);
    }
}

using System.ComponentModel.DataAnnotations;

namespace LteCar.Server.Data;

public class CarPinManager : EntityBase
{
    [Required]
    [MaxLength(64)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [MaxLength(64)]
    public string Type { get; set; } = string.Empty;

    public string? OptionsJson { get; set; }

    public DateTime? ModifiedAt { get; set; }

    public int CarId { get; set; }
    public Car Car { get; set; } = null!;
}

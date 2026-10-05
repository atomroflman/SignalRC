using System.ComponentModel.DataAnnotations;

namespace LteCar.Server.Data
{
    public class SetupFilterType : EntityBase
    {
        [MaxLength(256)]
        public string TypeName { get; set; } = string.Empty;
        [MaxLength(64)]
        public string? Name { get; set; }
        [MaxLength(512)]
        public string? Description { get; set; }
    }
}
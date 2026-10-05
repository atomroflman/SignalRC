using System.ComponentModel.DataAnnotations;

namespace LteCar.Server.Data;

/// <summary>
/// Vehicle hardware template stored on the server. Contains a complete <see cref="LteCar.Shared.Channels.ChannelMap"/>
/// that can be applied to a car to restore or initialize its configuration.
/// </summary>
public class ChannelTemplate : EntityBase
{
    [Required]
    [MaxLength(64)]
    public string Key { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? Description { get; set; }

    [MaxLength(32)]
    public string? Version { get; set; }

    [MaxLength(100)]
    public string? Author { get; set; }

    /// <summary>
    /// Serialized <see cref="LteCar.Shared.Channels.ChannelMap"/>.
    /// </summary>
    [Required]
    public string ChannelMapJson { get; set; } = string.Empty;

    /// <summary>
    /// SHA256 hash of the canonical channel map. Used to detect template updates.
    /// </summary>
    [Required]
    [MaxLength(64)]
    public string ChannelMapHash { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

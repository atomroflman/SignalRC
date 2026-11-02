namespace SignalRC.Server.Data;

// Overlay persistence (Shared/Overlay/api/README.md §2). Documents are stored
// as text, not jsonb: jsonb reorders keys, and the client diffs against the
// exact document it last saved.

/// <summary>The one shared draft of a vehicle's overlay.</summary>
public class OverlayDraft : EntityBase
{
    public int CarId { get; set; }
    public Car Car { get; set; } = null!;
    public long Revision { get; set; }
    public string DocumentJson { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; }
    public int? UpdatedByUserId { get; set; }
}

/// <summary>Recent draft revisions; the last 50 per vehicle are kept (D35).</summary>
public class OverlayDraftRevision : EntityBase
{
    public int CarId { get; set; }
    public long Revision { get; set; }
    public string DocumentJson { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public int? UserId { get; set; }
}

/// <summary>An immutable published state of standard, variants and assets.</summary>
public class OverlayPublication : EntityBase
{
    public int CarId { get; set; }
    public Car Car { get; set; } = null!;
    public int Number { get; set; }
    public int SchemaVersion { get; set; }
    public string DocumentJson { get; set; } = string.Empty;
    public DateTime PublishedAt { get; set; }
    public int? PublishedByUserId { get; set; }
    public string? PublishedByName { get; set; }
    public string? Note { get; set; }
    public long SourceDraftRevision { get; set; }
    public ICollection<OverlayPublicationAsset> Assets { get; set; } = new List<OverlayPublicationAsset>();
}

public class OverlayPublicationAsset : EntityBase
{
    public int PublicationId { get; set; }
    public OverlayPublication Publication { get; set; } = null!;
    public string AssetId { get; set; } = string.Empty;
}

public enum OverlayAssetStatus
{
    Pending = 0,
    Active = 1,
}

/// <summary>A sanitized, immutable SVG asset of a vehicle (content-addressed).</summary>
public class OverlayAsset : EntityBase
{
    public int CarId { get; set; }
    public Car Car { get; set; } = null!;
    public string AssetId { get; set; } = string.Empty;
    public string Svg { get; set; } = string.Empty;
    public string MetadataJson { get; set; } = string.Empty;
    public OverlayAssetStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }
    public int? CreatedByUserId { get; set; }
}

using System.Globalization;

namespace SignalRC.Server.Overlay.Assets;

/// <summary>Affine matrix in SVG order [a c e; b d f; 0 0 1].</summary>
internal readonly record struct SvgMatrix(double A, double B, double C, double D, double E, double F)
{
    public static readonly SvgMatrix Identity = new(1, 0, 0, 1, 0, 0);

    public bool IsIdentity => this == Identity;

    public static SvgMatrix Translate(double x, double y) => new(1, 0, 0, 1, x, y);
    public static SvgMatrix Scale(double x, double y) => new(x, 0, 0, y, 0, 0);

    public static SvgMatrix Rotate(double degrees)
    {
        var r = degrees * Math.PI / 180;
        var (sin, cos) = Math.SinCos(r);
        return new(cos, sin, -sin, cos, 0, 0);
    }

    /// <summary>this · other: <paramref name="other"/> is applied first.</summary>
    public SvgMatrix Multiply(SvgMatrix o) => new(
        A * o.A + C * o.B, B * o.A + D * o.B,
        A * o.C + C * o.D, B * o.C + D * o.D,
        A * o.E + C * o.F + E, B * o.E + D * o.F + F);

    public (double X, double Y) Apply(double x, double y) => (A * x + C * y + E, B * x + D * y + F);
}

/// <summary>Axis-aligned box; Empty until the first point.</summary>
internal struct SvgBox
{
    public double MinX, MinY, MaxX, MaxY;
    public bool HasValue;

    public void Add(double x, double y)
    {
        if (!HasValue) { MinX = MaxX = x; MinY = MaxY = y; HasValue = true; return; }
        MinX = Math.Min(MinX, x); MaxX = Math.Max(MaxX, x);
        MinY = Math.Min(MinY, y); MaxY = Math.Max(MaxY, y);
    }

    public void Add(SvgBox other)
    {
        if (!other.HasValue) return;
        Add(other.MinX, other.MinY);
        Add(other.MaxX, other.MaxY);
    }

    public readonly SvgBox Transform(SvgMatrix m)
    {
        var box = new SvgBox();
        if (!HasValue) return box;
        foreach (var (x, y) in new[] { (MinX, MinY), (MaxX, MinY), (MinX, MaxY), (MaxX, MaxY) })
        {
            var p = m.Apply(x, y);
            box.Add(p.X, p.Y);
        }
        return box;
    }
}

internal static class SvgNumber
{
    /// <summary>Canonical number text: at most six decimals, no exponent, no negative zero.</summary>
    public static string Format(double value)
    {
        var text = value.ToString("0.######", CultureInfo.InvariantCulture);
        return text == "-0" ? "0" : text;
    }

    public static bool InRange(double value) => double.IsFinite(value) && Math.Abs(value) <= SvgLimits.MaxAbsValue;
}

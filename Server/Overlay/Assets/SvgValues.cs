using System.Globalization;
using System.Text;

namespace SignalRC.Server.Overlay.Assets;

/// <summary>Reads SVG numbers, flags and separators from a string.</summary>
internal ref struct SvgScanner(ReadOnlySpan<char> text)
{
    private readonly ReadOnlySpan<char> _text = text;
    public int Position;

    public readonly bool AtEnd => Position >= _text.Length;
    public readonly char Current => _text[Position];

    public void SkipWhitespace()
    {
        while (Position < _text.Length && IsWhitespace(_text[Position])) Position++;
    }

    /// <summary>Whitespace with at most one comma.</summary>
    public void SkipSeparator()
    {
        SkipWhitespace();
        if (Position < _text.Length && _text[Position] == ',') { Position++; SkipWhitespace(); }
    }

    public static bool IsWhitespace(char c) => c is ' ' or '\t' or '\n' or '\r' or '\f';

    public bool TryNumber(out double value)
    {
        value = 0;
        var start = Position;
        var i = Position;
        if (i < _text.Length && _text[i] is '+' or '-') i++;
        var digits = 0;
        while (i < _text.Length && char.IsAsciiDigit(_text[i])) { i++; digits++; }
        if (i < _text.Length && _text[i] == '.')
        {
            var j = i + 1;
            var fraction = 0;
            while (j < _text.Length && char.IsAsciiDigit(_text[j])) { j++; fraction++; }
            if (fraction > 0 || digits > 0) { i = j; digits += fraction; }
        }
        if (digits == 0) return false;
        if (i < _text.Length && _text[i] is 'e' or 'E')
        {
            var j = i + 1;
            if (j < _text.Length && _text[j] is '+' or '-') j++;
            var exp = 0;
            while (j < _text.Length && char.IsAsciiDigit(_text[j])) { j++; exp++; }
            if (exp > 0) i = j;
        }
        if (!double.TryParse(_text[start..i], NumberStyles.Float, CultureInfo.InvariantCulture, out value) || !double.IsFinite(value)) return false;
        Position = i;
        return true;
    }

    public bool TryFlag(out bool flag)
    {
        flag = false;
        if (Position < _text.Length && _text[Position] is '0' or '1')
        {
            flag = _text[Position] == '1';
            Position++;
            return true;
        }
        return false;
    }

    public readonly ReadOnlySpan<char> Rest => _text[Position..];
}

internal enum LengthAxis { X, Y, Other }

/// <summary>Context for resolving lengths: viewBox for %, or the 0..1 range of objectBoundingBox units.</summary>
internal readonly record struct LengthContext(double Width, double Height, bool BoundingBoxUnits = false)
{
    public double PercentBase(LengthAxis axis) => BoundingBoxUnits ? 1 : axis switch
    {
        LengthAxis.X => Width,
        LengthAxis.Y => Height,
        _ => Math.Sqrt((Width * Width + Height * Height) / 2),
    };
}

internal enum ValueStatus { Ok, Converted, Invalid, FontRelative }

internal static class SvgValues
{
    // --- Lengths ---

    public static ValueStatus Length(string text, LengthAxis axis, LengthContext ctx, out double value)
    {
        var s = new SvgScanner(text.AsSpan().Trim());
        if (!s.TryNumber(out value)) return ValueStatus.Invalid;
        var status = Unit(s.Rest, axis, ctx, ref value);
        return status != ValueStatus.Invalid && !SvgNumber.InRange(value) ? ValueStatus.Invalid : status;
    }

    private static ValueStatus Unit(ReadOnlySpan<char> unit, LengthAxis axis, LengthContext ctx, ref double value)
    {
        var u = unit.ToString().ToLowerInvariant();
        switch (u)
        {
            case "": case "px": return ValueStatus.Ok;
            case "mm": value *= 96 / 25.4; return ValueStatus.Converted;
            case "cm": value *= 96 / 2.54; return ValueStatus.Converted;
            case "in": value *= 96; return ValueStatus.Converted;
            case "pt": value *= 96.0 / 72; return ValueStatus.Converted;
            case "pc": value *= 16; return ValueStatus.Converted;
            case "%": value = value / 100 * ctx.PercentBase(axis); return ValueStatus.Converted;
            case "em": case "ex": case "rem": case "ch": return ValueStatus.FontRelative;
            default: return ValueStatus.Invalid;
        }
    }

    /// <summary>Whitespace/comma separated lengths (text x/y/dx/dy, dash arrays).</summary>
    public static ValueStatus LengthList(string text, LengthAxis axis, LengthContext ctx, out List<double> values)
    {
        values = [];
        var status = ValueStatus.Ok;
        foreach (var item in text.Split((char[])[' ', ',', '\t', '\n', '\r'], StringSplitOptions.RemoveEmptyEntries))
        {
            var s = Length(item, axis, ctx, out var v);
            if (s is ValueStatus.Invalid or ValueStatus.FontRelative) return s;
            if (s == ValueStatus.Converted) status = ValueStatus.Converted;
            values.Add(v);
        }
        return values.Count == 0 ? ValueStatus.Invalid : status;
    }

    /// <summary>Plain number or percentage clamped to [0, 1] (opacities, stop offsets).</summary>
    public static bool Fraction(string text, out double value)
    {
        var s = new SvgScanner(text.AsSpan().Trim());
        if (!s.TryNumber(out value)) return false;
        var rest = s.Rest.Trim();
        if (rest.Length == 1 && rest[0] == '%') value /= 100;
        else if (rest.Length != 0) return false;
        value = Math.Clamp(value, 0, 1);
        return true;
    }

    public static bool Number(string text, out double value)
    {
        var s = new SvgScanner(text.AsSpan().Trim());
        return s.TryNumber(out value) && s.AtEnd && SvgNumber.InRange(value);
    }

    public static bool NumberList(string text, out List<double> values)
    {
        values = [];
        var s = new SvgScanner(text);
        s.SkipWhitespace();
        while (!s.AtEnd)
        {
            if (!s.TryNumber(out var v) || !SvgNumber.InRange(v)) return false;
            values.Add(v);
            s.SkipSeparator();
        }
        return true;
    }

    // --- Colors ---

    /// <summary>Normalizes a color to #rrggbb / #rrggbbaa; currentColor is replaced by <paramref name="current"/>.</summary>
    public static string? Color(string text, string current)
    {
        var t = text.Trim();
        var lower = t.ToLowerInvariant();
        if (lower == "currentcolor") return current;
        if (lower == "transparent") return "#00000000";
        if (t.StartsWith('#')) return Hex(t[1..]);
        if (SvgColorNames.Table.TryGetValue(lower, out var named)) return "#" + named;
        var open = lower.IndexOf('(');
        if (open > 0 && lower.EndsWith(')'))
        {
            var name = lower[..open].Trim();
            var args = lower[(open + 1)..^1].Replace("/", " ").Split((char[])[' ', ','], StringSplitOptions.RemoveEmptyEntries);
            if (args.Length is not (3 or 4)) return null;
            if (name is "rgb" or "rgba")
            {
                var channels = new double[3];
                for (var i = 0; i < 3; i++)
                {
                    if (!Channel(args[i], 255, out channels[i])) return null;
                }
                return Rgb(channels[0], channels[1], channels[2], args.Length == 4 ? args[3] : null);
            }
            if (name is "hsl" or "hsla")
            {
                if (!double.TryParse(args[0].Replace("deg", ""), NumberStyles.Float, CultureInfo.InvariantCulture, out var h)) return null;
                if (!Channel(args[1], 1, out var sat) || !Channel(args[2], 1, out var light)) return null;
                if (!args[1].EndsWith('%') || !args[2].EndsWith('%')) return null;
                var (r, g, b) = HslToRgb(h, sat, light);
                return Rgb(r * 255, g * 255, b * 255, args.Length == 4 ? args[3] : null);
            }
        }
        return null;
    }

    private static string? Hex(string digits)
    {
        if (!digits.All(char.IsAsciiHexDigit)) return null;
        var d = digits.ToLowerInvariant();
        switch (d.Length)
        {
            case 3: case 4:
                d = string.Concat(d.Select(c => $"{c}{c}"));
                break;
            case 6: case 8:
                break;
            default:
                return null;
        }
        return "#" + (d.Length == 8 && d.EndsWith("ff") ? d[..6] : d);
    }

    private static bool Channel(string text, double max, out double value)
    {
        var percent = text.EndsWith('%');
        var number = percent ? text[..^1] : text;
        if (!double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out value) || !double.IsFinite(value)) return false;
        value = percent ? value / 100 * max : value;
        value = Math.Clamp(value, 0, max);
        return true;
    }

    private static string? Rgb(double r, double g, double b, string? alpha)
    {
        var hex = $"#{(int)Math.Round(r):x2}{(int)Math.Round(g):x2}{(int)Math.Round(b):x2}";
        if (alpha == null) return hex;
        if (!Fraction(alpha, out var a)) return null;
        var aa = (int)Math.Round(a * 255);
        return aa == 255 ? hex : $"{hex}{aa:x2}";
    }

    private static (double R, double G, double B) HslToRgb(double h, double s, double l)
    {
        h = ((h % 360) + 360) % 360 / 360;
        if (s == 0) return (l, l, l);
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        return (Hue(p, q, h + 1.0 / 3), Hue(p, q, h), Hue(p, q, h - 1.0 / 3));

        static double Hue(double p, double q, double t)
        {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1.0 / 6) return p + (q - p) * 6 * t;
            if (t < 0.5) return q;
            if (t < 2.0 / 3) return p + (q - p) * (2.0 / 3 - t) * 6;
            return p;
        }
    }

    /// <summary>Splits <c>url(#id) fallback</c>; null when the value is not a url().</summary>
    public static (string Target, string? Fallback)? Url(string text)
    {
        var t = text.Trim();
        if (!t.StartsWith("url(", StringComparison.OrdinalIgnoreCase)) return null;
        var close = t.IndexOf(')');
        if (close < 0) return ("", null);
        var target = t[4..close].Trim().Trim('"', '\'').Trim();
        var fallback = t[(close + 1)..].Trim();
        return (target, fallback.Length > 0 ? fallback : null);
    }

    // --- Transforms ---

    public static SvgMatrix? Transform(string text)
    {
        var m = SvgMatrix.Identity;
        var span = text.AsSpan();
        var i = 0;
        var any = false;
        while (true)
        {
            while (i < span.Length && (SvgScanner.IsWhitespace(span[i]) || span[i] == ',')) i++;
            if (i >= span.Length) break;
            var nameStart = i;
            while (i < span.Length && char.IsAsciiLetter(span[i])) i++;
            var name = span[nameStart..i].ToString();
            while (i < span.Length && SvgScanner.IsWhitespace(span[i])) i++;
            if (i >= span.Length || span[i] != '(') return null;
            var close = span[i..].IndexOf(')');
            if (close < 0) return null;
            var args = new List<double>();
            var s = new SvgScanner(span[(i + 1)..(i + close)]);
            s.SkipWhitespace();
            while (!s.AtEnd)
            {
                if (!s.TryNumber(out var v)) return null;
                args.Add(v);
                s.SkipSeparator();
            }
            i += close + 1;
            SvgMatrix? step = (name, args.Count) switch
            {
                ("matrix", 6) => new SvgMatrix(args[0], args[1], args[2], args[3], args[4], args[5]),
                ("translate", 1) => SvgMatrix.Translate(args[0], 0),
                ("translate", 2) => SvgMatrix.Translate(args[0], args[1]),
                ("scale", 1) => SvgMatrix.Scale(args[0], args[0]),
                ("scale", 2) => SvgMatrix.Scale(args[0], args[1]),
                ("rotate", 1) => SvgMatrix.Rotate(args[0]),
                ("rotate", 3) => SvgMatrix.Translate(args[1], args[2]).Multiply(SvgMatrix.Rotate(args[0])).Multiply(SvgMatrix.Translate(-args[1], -args[2])),
                ("skewX", 1) => new SvgMatrix(1, 0, Math.Tan(args[0] * Math.PI / 180), 1, 0, 0),
                ("skewY", 1) => new SvgMatrix(1, Math.Tan(args[0] * Math.PI / 180), 0, 1, 0, 0),
                _ => null,
            };
            if (step == null) return null;
            m = m.Multiply(step.Value);
            any = true;
        }
        if (!any) return null;
        return new[] { m.A, m.B, m.C, m.D, m.E, m.F }.All(SvgNumber.InRange) ? m : null;
    }

    public static string FormatTransform(SvgMatrix m)
    {
        var r = new SvgMatrix(Round(m.A), Round(m.B), Round(m.C), Round(m.D), Round(m.E), Round(m.F));
        if (r.A == 1 && r.B == 0 && r.C == 0 && r.D == 1) return $"translate({SvgNumber.Format(r.E)} {SvgNumber.Format(r.F)})";
        return $"matrix({SvgNumber.Format(r.A)} {SvgNumber.Format(r.B)} {SvgNumber.Format(r.C)} {SvgNumber.Format(r.D)} {SvgNumber.Format(r.E)} {SvgNumber.Format(r.F)})";
    }

    /// <summary>The matrix as it is written to the output, so that boxes match the serialized geometry.</summary>
    public static SvgMatrix Rounded(SvgMatrix m) => new(Round(m.A), Round(m.B), Round(m.C), Round(m.D), Round(m.E), Round(m.F));

    public static double Round(double v)
    {
        var r = Math.Round(v, 6, MidpointRounding.AwayFromZero);
        return r == 0 ? 0 : r;
    }

    // --- Path data ---

    public sealed record PathData(string D, int Points, SvgBox Box, bool Truncated);

    /// <summary>
    /// Parses path data into absolute M/L/C/Q/A/Z commands. On an error the
    /// valid prefix is kept, as browsers render up to the first error.
    /// </summary>
    public static PathData Path(string text)
    {
        var s = new SvgScanner(text);
        var sb = new StringBuilder();
        var box = new SvgBox();
        var points = 0;
        double cx = 0, cy = 0, sx = 0, sy = 0; // current point, subpath start
        double qx = 0, qy = 0;                 // last control point for S/T
        var last = ' ';
        var command = ' ';
        var truncated = false;
        s.SkipWhitespace();
        while (!s.AtEnd)
        {
            var c = s.Current;
            if (char.IsAsciiLetter(c))
            {
                if ("MmLlHhVvCcSsQqTtAaZz".IndexOf(c) < 0) { truncated = true; break; }
                command = c;
                s.Position++;
                s.SkipWhitespace();
            }
            else if (command == ' ' || char.ToUpperInvariant(command) == 'Z')
            {
                truncated = true;
                break;
            }
            if (sb.Length == 0 && char.ToUpperInvariant(command) != 'M') { truncated = true; break; }

            var rel = char.IsAsciiLetterLower(command);
            var ox = rel ? cx : 0;
            var oy = rel ? cy : 0;
            var segment = new StringBuilder();
            var ok = true;
            switch (char.ToUpperInvariant(command))
            {
                case 'Z':
                    segment.Append('Z');
                    cx = sx; cy = sy;
                    qx = cx; qy = cy;
                    break;
                case 'M':
                case 'L':
                {
                    if (!(ok = Pair(ref s, out var x, out var y))) break;
                    x += ox; y += oy;
                    var upper = char.ToUpperInvariant(command);
                    segment.Append(upper).Append(Fmt(x, y));
                    if (upper == 'M') { sx = x; sy = y; command = rel ? 'l' : 'L'; }
                    cx = x; cy = y; qx = x; qy = y;
                    box.Add(x, y);
                    points++;
                    break;
                }
                case 'H':
                case 'V':
                {
                    if (!(ok = s.TryNumber(out var v))) break;
                    var x = char.ToUpperInvariant(command) == 'H' ? v + ox : cx;
                    var y = char.ToUpperInvariant(command) == 'V' ? v + oy : cy;
                    segment.Append('L').Append(Fmt(x, y));
                    cx = x; cy = y; qx = x; qy = y;
                    box.Add(x, y);
                    points++;
                    break;
                }
                case 'C':
                case 'S':
                {
                    double x1, y1;
                    if (char.ToUpperInvariant(command) == 'C')
                    {
                        if (!(ok = Pair(ref s, out x1, out y1))) break;
                        x1 += ox; y1 += oy;
                        s.SkipSeparator();
                    }
                    else
                    {
                        var smooth = char.ToUpperInvariant(last) is 'C' or 'S';
                        x1 = smooth ? 2 * cx - qx : cx;
                        y1 = smooth ? 2 * cy - qy : cy;
                    }
                    if (!(ok = Pair(ref s, out var x2, out var y2))) break;
                    s.SkipSeparator();
                    if (!(ok = Pair(ref s, out var x, out var y))) break;
                    x2 += ox; y2 += oy; x += ox; y += oy;
                    segment.Append('C').Append(Fmt(x1, y1)).Append(' ').Append(Fmt(x2, y2)).Append(' ').Append(Fmt(x, y));
                    box.Add(x1, y1); box.Add(x2, y2); box.Add(x, y);
                    points += 3;
                    qx = x2; qy = y2; cx = x; cy = y;
                    break;
                }
                case 'Q':
                case 'T':
                {
                    double x1, y1;
                    if (char.ToUpperInvariant(command) == 'Q')
                    {
                        if (!(ok = Pair(ref s, out x1, out y1))) break;
                        x1 += ox; y1 += oy;
                        s.SkipSeparator();
                    }
                    else
                    {
                        var smooth = char.ToUpperInvariant(last) is 'Q' or 'T';
                        x1 = smooth ? 2 * cx - qx : cx;
                        y1 = smooth ? 2 * cy - qy : cy;
                    }
                    if (!(ok = Pair(ref s, out var x, out var y))) break;
                    x += ox; y += oy;
                    segment.Append('Q').Append(Fmt(x1, y1)).Append(' ').Append(Fmt(x, y));
                    box.Add(x1, y1); box.Add(x, y);
                    points += 2;
                    qx = x1; qy = y1; cx = x; cy = y;
                    break;
                }
                case 'A':
                {
                    if (!(ok = s.TryNumber(out var rx))) break;
                    s.SkipSeparator();
                    if (!(ok = s.TryNumber(out var ry))) break;
                    s.SkipSeparator();
                    if (!(ok = s.TryNumber(out var rotation))) break;
                    s.SkipSeparator();
                    if (!(ok = s.TryFlag(out var large))) break;
                    s.SkipSeparator();
                    if (!(ok = s.TryFlag(out var sweep))) break;
                    s.SkipSeparator();
                    if (!(ok = Pair(ref s, out var x, out var y))) break;
                    x += ox; y += oy;
                    rx = Math.Abs(rx); ry = Math.Abs(ry);
                    if (!(ok = SvgNumber.InRange(rx) && SvgNumber.InRange(ry) && SvgNumber.InRange(rotation))) break;
                    if (rx == 0 || ry == 0)
                    {
                        segment.Append('L').Append(Fmt(x, y));
                        box.Add(x, y);
                        points++;
                    }
                    else
                    {
                        segment.Append('A').Append(SvgNumber.Format(Round(rx))).Append(' ').Append(SvgNumber.Format(Round(ry))).Append(' ')
                            .Append(SvgNumber.Format(Round(rotation))).Append(' ').Append(large ? '1' : '0').Append(' ').Append(sweep ? '1' : '0')
                            .Append(' ').Append(Fmt(x, y));
                        ArcBox(ref box, cx, cy, Round(rx), Round(ry), Round(rotation), large, sweep, x, y);
                        points += 2;
                    }
                    cx = x; cy = y; qx = x; qy = y;
                    break;
                }
            }
            if (!ok || !SvgNumber.InRange(cx) || !SvgNumber.InRange(cy) || !SvgNumber.InRange(qx) || !SvgNumber.InRange(qy))
            {
                truncated = true;
                break;
            }
            sb.Append(segment);
            last = command;
            s.SkipSeparator();
        }
        // A lone moveto draws nothing.
        var d = sb.ToString();
        return new PathData(d.Skip(1).Any(char.IsAsciiLetter) ? d : "", points, box, truncated);
    }

    private static bool Pair(ref SvgScanner s, out double x, out double y)
    {
        y = 0;
        if (!s.TryNumber(out x)) return false;
        s.SkipSeparator();
        return s.TryNumber(out y);
    }

    private static string Fmt(double x, double y) => SvgNumber.Format(Round(x)) + " " + SvgNumber.Format(Round(y));

    /// <summary>Bounding box of the full ellipse of an arc (SVG 1.1 F.6.5), conservative.</summary>
    private static void ArcBox(ref SvgBox box, double x1, double y1, double rx, double ry, double degrees, bool large, bool sweep, double x2, double y2)
    {
        box.Add(x1, y1);
        box.Add(x2, y2);
        var phi = degrees * Math.PI / 180;
        var (sin, cos) = Math.SinCos(phi);
        var dx = (x1 - x2) / 2;
        var dy = (y1 - y2) / 2;
        var xp = cos * dx + sin * dy;
        var yp = -sin * dx + cos * dy;
        var lambda = xp * xp / (rx * rx) + yp * yp / (ry * ry);
        if (lambda > 1) { rx *= Math.Sqrt(lambda); ry *= Math.Sqrt(lambda); }
        var num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
        var den = rx * rx * yp * yp + ry * ry * xp * xp;
        var factor = den == 0 ? 0 : Math.Sqrt(Math.Max(0, num / den)) * (large == sweep ? -1 : 1);
        var cxp = factor * rx * yp / ry;
        var cyp = -factor * ry * xp / rx;
        var ccx = cos * cxp - sin * cyp + (x1 + x2) / 2;
        var ccy = sin * cxp + cos * cyp + (y1 + y2) / 2;
        var hw = Math.Sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
        var hh = Math.Sqrt(rx * rx * sin * sin + ry * ry * cos * cos);
        if (double.IsFinite(ccx) && double.IsFinite(ccy) && double.IsFinite(hw) && double.IsFinite(hh))
        {
            box.Add(ccx - hw, ccy - hh);
            box.Add(ccx + hw, ccy + hh);
        }
    }

    // --- Fonts ---

    /// <summary>D45: maps a font-family list onto the four generic families by its first entry.</summary>
    public static string FontFamily(string text)
    {
        var first = text.Split(',')[0].Trim().Trim('"', '\'').Trim().ToLowerInvariant();
        if (first.Contains("mono") || first.Contains("courier") || first.Contains("consol")) return "monospace";
        if (first.Contains("condensed") || first.Contains("narrow")) return "condensed";
        if (!first.Contains("sans") && (first.Contains("serif") || first.Contains("times") || first.Contains("georgia") || first.Contains("garamond"))) return "serif";
        return "sans-serif";
    }
}

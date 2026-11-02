using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

namespace SignalRC.Server.Overlay.Assets;

/// <summary>
/// Independent check of a normalized asset. It shares no code with the
/// sanitizer: it re-parses the output and accepts only the canonical forms the
/// sanitizer is meant to write. Any finding means a sanitizer defect; the asset
/// is then rejected. Also usable on stored assets.
/// </summary>
public static partial class SvgSafetyCheck
{
    private const string Ns = "http://www.w3.org/2000/svg";
    private const string Num = @"-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?";

    [GeneratedRegex("^" + Num + "$")]
    private static partial Regex NumberPattern();

    [GeneratedRegex("^" + Num + "(?: " + Num + ")*$")]
    private static partial Regex NumberListPattern();

    [GeneratedRegex("^(?:#[0-9a-f]{6}(?:[0-9a-f]{2})?|none|url\\(#r[1-9][0-9]*\\))$")]
    private static partial Regex PaintPattern();

    [GeneratedRegex("^#[0-9a-f]{6}(?:[0-9a-f]{2})?$")]
    private static partial Regex ColorPattern();

    [GeneratedRegex("^url\\(#(r[1-9][0-9]*)\\)$")]
    private static partial Regex UrlPattern();

    [GeneratedRegex("^(?:translate\\(" + Num + " " + Num + "\\)|matrix\\(" + Num + "(?: " + Num + "){5}\\))$")]
    private static partial Regex TransformPattern();

    [GeneratedRegex("^(?:[MLCQAZ](?:" + Num + "(?: " + Num + ")*)?)+$")]
    private static partial Regex PathPattern();

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex PartPattern();

    [GeneratedRegex("^r[1-9][0-9]*$")]
    private static partial Regex RefPattern();

    private static readonly string[] Paint = ["fill", "stroke"];
    private static readonly string[] Presentation =
    [
        "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
        "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity",
        "clip-path", "clip-rule", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "letter-spacing",
    ];

    private static readonly Dictionary<string, (string[] Parents, string[] Attributes)> Elements = Build();

    private static Dictionary<string, (string[], string[])> Build()
    {
        string[] content = ["svg", "g"];
        string[] shapeParents = ["svg", "g", "clipPath"];
        string[] shape = ["data-part", "transform", .. Presentation];
        return new()
        {
            ["g"] = (content, shape),
            ["defs"] = (content, []),
            ["path"] = (shapeParents, ["d", .. shape]),
            ["rect"] = (shapeParents, ["x", "y", "width", "height", "rx", "ry", .. shape]),
            ["circle"] = (shapeParents, ["cx", "cy", "r", .. shape]),
            ["ellipse"] = (shapeParents, ["cx", "cy", "rx", "ry", .. shape]),
            ["line"] = (shapeParents, ["x1", "y1", "x2", "y2", .. shape]),
            ["polyline"] = (shapeParents, ["points", .. shape]),
            ["polygon"] = (shapeParents, ["points", .. shape]),
            ["text"] = (shapeParents, ["x", "y", "dx", "dy", .. shape]),
            ["tspan"] = (["text", "tspan"], ["x", "y", "dx", "dy", .. Presentation]),
            ["linearGradient"] = (["svg", "g", "defs"], ["id", "x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform", "spreadMethod"]),
            ["radialGradient"] = (["svg", "g", "defs"], ["id", "cx", "cy", "r", "fx", "fy", "fr", "gradientUnits", "gradientTransform", "spreadMethod"]),
            ["stop"] = (["linearGradient", "radialGradient"], ["offset", "stop-color", "stop-opacity"]),
            ["clipPath"] = (["svg", "g", "defs"], ["id", "clipPathUnits", "transform"]),
        };
    }

    /// <summary>Null when the asset is acceptable, otherwise the first finding.</summary>
    public static string? Verify(string svg)
    {
        if (Encoding.UTF8.GetByteCount(svg) > SvgLimits.MaxOutputBytes) return "size";
        if (!svg.StartsWith("<svg xmlns=\"" + Ns + "\" viewBox=\"0 0 ", StringComparison.Ordinal)) return "prologue";
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersFromEntities = 0,
        };
        var ids = new Dictionary<string, string>();
        var urls = new List<(string Id, bool Clip)>();
        var parts = new HashSet<string>();
        var stack = new Stack<string>();
        var elements = 0;
        var textChars = 0;
        try
        {
            using var reader = XmlReader.Create(new StringReader(svg), settings);
            while (reader.Read())
            {
                switch (reader.NodeType)
                {
                    case XmlNodeType.Element:
                    {
                        if (reader.NamespaceURI != Ns || reader.Prefix != "") return $"namespace {reader.Name}";
                        var name = reader.LocalName;
                        elements++;
                        if (stack.Count == 0)
                        {
                            if (name != "svg") return "root";
                            if (CheckRoot(reader) is { } rootError) return rootError;
                        }
                        else
                        {
                            if (!Elements.TryGetValue(name, out var rule)) return $"element {name}";
                            if (!rule.Parents.Contains(stack.Peek())) return $"{stack.Peek()} > {name}";
                            if (CheckAttributes(reader, name, rule.Attributes, ids, urls, parts) is { } error) return error;
                        }
                        if (!reader.IsEmptyElement)
                        {
                            stack.Push(name);
                            if (stack.Count > SvgLimits.MaxDepth) return "depth";
                        }
                        else if (stack.Count + 1 > SvgLimits.MaxDepth)
                        {
                            return "depth";
                        }
                        break;
                    }
                    case XmlNodeType.EndElement:
                        stack.Pop();
                        break;
                    case XmlNodeType.Text or XmlNodeType.Whitespace or XmlNodeType.SignificantWhitespace:
                        if (stack.Count == 0 || stack.Peek() is not ("text" or "tspan")) return "text outside text";
                        textChars += reader.Value.Length;
                        break;
                    default:
                        // No comments, CDATA, processing instructions, whitespace or declarations.
                        return $"node {reader.NodeType}";
                }
            }
        }
        catch (XmlException)
        {
            return "xml";
        }
        if (elements > SvgLimits.MaxElements) return "elements";
        if (textChars > SvgLimits.MaxTextCharacters) return "text";
        if (ids.Count > SvgLimits.MaxDefinitions) return "definitions";
        foreach (var (id, clip) in urls)
        {
            if (!ids.TryGetValue(id, out var kind)) return $"dangling #{id}";
            if (clip != (kind == "clipPath")) return $"reference kind #{id}";
        }
        return null;
    }

    private static string? CheckRoot(XmlReader reader)
    {
        if (reader.AttributeCount != 2) return "root attributes";
        if (reader.GetAttribute("xmlns") != Ns) return "root xmlns";
        var viewBox = reader.GetAttribute("viewBox");
        if (viewBox == null || !viewBox.StartsWith("0 0 ", StringComparison.Ordinal)) return "viewBox";
        var size = viewBox[4..].Split(' ');
        if (size.Length != 2 || !size.All(v => IsNumber(v, out var n) && n > 0)) return "viewBox";
        return null;
    }

    private static string? CheckAttributes(XmlReader reader, string element, string[] allowed, Dictionary<string, string> ids,
        List<(string, bool)> urls, HashSet<string> parts)
    {
        if (!reader.MoveToFirstAttribute()) return Required(element, []);
        var seen = new List<string>();
        do
        {
            if (reader.NamespaceURI != "" || reader.Prefix != "") return $"attribute {reader.Name}";
            var name = reader.LocalName;
            var value = reader.Value;
            if (!allowed.Contains(name)) return $"attribute {element}@{name}";
            seen.Add(name);
            var ok = name switch
            {
                "id" => RefPattern().IsMatch(value) && ids.TryAdd(value, element),
                "data-part" => PartPattern().IsMatch(value) && parts.Add(value),
                "transform" or "gradientTransform" => TransformPattern().IsMatch(value) && AllInRange(value),
                "d" => PathPattern().IsMatch(value) && AllInRange(value),
                "points" => NumberListPattern().IsMatch(value) && value.Split(' ').Length % 2 == 0 && AllInRange(value),
                "x" or "y" or "dx" or "dy" when element is "text" or "tspan" => NumberListPattern().IsMatch(value) && AllInRange(value),
                "stroke-dasharray" => value == "none" || (NumberListPattern().IsMatch(value) && AllInRange(value)),
                "fill" or "stroke" => PaintPattern().IsMatch(value) && Track(value, false, urls),
                "clip-path" => UrlPattern().IsMatch(value) && Track(value, true, urls),
                "stop-color" => ColorPattern().IsMatch(value),
                "opacity" or "fill-opacity" or "stroke-opacity" or "stop-opacity" or "offset" => IsNumber(value, out var f) && f is >= 0 and <= 1,
                "width" or "height" or "r" or "rx" or "ry" or "fr" or "stroke-width" => IsNumber(value, out var l) && l >= 0,
                "font-size" or "stroke-miterlimit" => IsNumber(value, out var p) && p > 0,
                "x" or "y" or "x1" or "y1" or "x2" or "y2" or "cx" or "cy" or "fx" or "fy" or "stroke-dashoffset" or "letter-spacing" => IsNumber(value, out _),
                "fill-rule" or "clip-rule" => value is "nonzero" or "evenodd",
                "stroke-linecap" => value is "butt" or "round" or "square",
                "stroke-linejoin" => value is "miter" or "round" or "bevel",
                "font-family" => value is "sans-serif" or "serif" or "monospace" or "condensed",
                "font-weight" => value is "normal" or "bold" or "bolder" or "lighter" || (int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var w) && w is >= 1 and <= 1000),
                "font-style" => value is "normal" or "italic" or "oblique",
                "text-anchor" => value is "start" or "middle" or "end",
                "gradientUnits" or "clipPathUnits" => value is "userSpaceOnUse" or "objectBoundingBox",
                "spreadMethod" => value is "pad" or "reflect" or "repeat",
                _ => false,
            };
            if (!ok) return $"value {element}@{name}";
        } while (reader.MoveToNextAttribute());
        reader.MoveToElement();
        return Required(element, seen);
    }

    private static string? Required(string element, List<string> seen) =>
        element is "linearGradient" or "radialGradient" or "clipPath" && !seen.Contains("id") ? $"{element} without id" : null;

    private static bool Track(string value, bool clip, List<(string, bool)> urls)
    {
        var match = UrlPattern().Match(value);
        if (match.Success) urls.Add((match.Groups[1].Value, clip));
        return true;
    }

    [GeneratedRegex(Num)]
    private static partial Regex NumberToken();

    private static bool AllInRange(string value) =>
        NumberToken().Matches(value).All(m => IsNumber(m.Value, out _));

    private static bool IsNumber(string value, out double number)
    {
        number = 0;
        return NumberPattern().IsMatch(value)
            && double.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out number)
            && Math.Abs(number) <= SvgLimits.MaxAbsValue;
    }
}

using System.Text;
using System.Text.RegularExpressions;

namespace SignalRC.Server.Overlay.Assets;

/// <summary>
/// D52: resolves &lt;style&gt; rules with type, class and id selectors (and
/// compounds of them, without combinators) plus style attributes into
/// presentation attributes. Removes class, style and &lt;style&gt; afterwards.
/// </summary>
internal static partial class SvgCss
{
    /// <summary>CSS properties turned into attributes; display/visibility/color are evaluated later and then dropped.</summary>
    public static readonly HashSet<string> Properties =
    [
        "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
        "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity",
        "clip-path", "clip-rule", "font-family", "font-size", "font-weight", "font-style", "text-anchor",
        "letter-spacing", "stop-color", "stop-opacity", "display", "visibility", "color",
    ];

    private sealed record Declaration(string Property, string Value);

    private sealed record Rule(string? Type, string? Id, string[] Classes, int Specificity, int Order, List<Declaration> Declarations);

    [GeneratedRegex(@"^(?<type>[A-Za-z][A-Za-z0-9_-]*)?(?<rest>(?:[.#][A-Za-z_-][A-Za-z0-9_-]*)*)$")]
    private static partial Regex SimpleSelector();

    public static void Resolve(SvgElement root, SvgReport report)
    {
        var rules = new List<Rule>();
        foreach (var style in root.Descendants().Where(e => e.Name == "style").ToList())
        {
            var type = style.Get("type");
            if (type == null || type.Trim().Equals("text/css", StringComparison.OrdinalIgnoreCase))
            {
                var css = string.Concat(style.Children.OfType<SvgTextNode>().Select(t => t.Text));
                ParseStylesheet(css, rules, report);
            }
        }
        RemoveStyleElements(root);
        Apply(root, rules, report);
    }

    private static void RemoveStyleElements(SvgElement parent)
    {
        parent.Children.RemoveAll(c => c is SvgElement { Name: "style" });
        foreach (var child in parent.Elements) RemoveStyleElements(child);
    }

    private static void Apply(SvgElement element, List<Rule> rules, SvgReport report)
    {
        var id = element.Get("id");
        var classes = (element.Get("class") ?? "").Split((char[])[' ', '\t', '\n', '\r', '\f'], StringSplitOptions.RemoveEmptyEntries);
        var matched = rules
            .Where(r => (r.Type == null || r.Type == element.Name) && (r.Id == null || r.Id == id) && r.Classes.All(classes.Contains))
            .OrderBy(r => r.Specificity).ThenBy(r => r.Order);
        // Cascade: style attribute over rules over presentation attributes.
        foreach (var rule in matched)
        {
            foreach (var d in rule.Declarations) element.Set(d.Property, d.Value);
        }
        if (element.Get("style") is { } inline)
        {
            foreach (var d in ParseDeclarations(inline, report)) element.Set(d.Property, d.Value);
        }
        element.Remove("style");
        element.Remove("class");
        foreach (var child in element.Elements) Apply(child, rules, report);
    }

    private static void ParseStylesheet(string css, List<Rule> rules, SvgReport report)
    {
        var text = StripComments(css);
        var i = 0;
        while (i < text.Length)
        {
            if (char.IsWhiteSpace(text[i]) || text[i] == ';') { i++; continue; }
            if (text.AsSpan(i).StartsWith("<!--") || text.AsSpan(i).StartsWith("-->"))
            {
                i += text[i] == '<' ? 4 : 3;
                continue;
            }
            if (text[i] == '@')
            {
                var name = new string(text[(i + 1)..].TakeWhile(c => char.IsLetterOrDigit(c) || c == '-').ToArray());
                report.Add(SvgReportCodes.UnsupportedCss, "@" + name);
                i = SkipAtRule(text, i);
                continue;
            }
            var open = IndexOutsideStrings(text, i, '{');
            if (open < 0)
            {
                report.Add(SvgReportCodes.UnsupportedCss, text[i..].Trim());
                break;
            }
            var close = MatchingBrace(text, open);
            var prelude = text[i..open].Trim();
            var body = text[(open + 1)..Math.Max(open + 1, close)];
            i = close < 0 ? text.Length : close + 1;
            var declarations = ParseDeclarations(body, report);
            foreach (var selector in prelude.Split(','))
            {
                var s = selector.Trim();
                if (ParseSelector(s) is { } parsed)
                {
                    rules.Add(parsed with { Order = rules.Count, Declarations = declarations });
                }
                else
                {
                    report.Add(SvgReportCodes.UnsupportedCss, s);
                }
            }
        }
    }

    private static Rule? ParseSelector(string selector)
    {
        var match = SimpleSelector().Match(selector);
        if (!match.Success || selector.Length == 0) return null;
        var type = match.Groups["type"].Success && match.Groups["type"].Length > 0 ? match.Groups["type"].Value : null;
        string? id = null;
        var ids = 0;
        var classes = new List<string>();
        foreach (Match part in Regex.Matches(match.Groups["rest"].Value, @"([.#])([A-Za-z0-9_-]+)"))
        {
            if (part.Groups[1].Value == "#")
            {
                // Two different ids can never match the same element.
                if (id != null && id != part.Groups[2].Value) return null;
                id = part.Groups[2].Value;
                ids++;
            }
            else
            {
                classes.Add(part.Groups[2].Value);
            }
        }
        var specificity = ids * 10_000 + classes.Count * 100 + (type == null ? 0 : 1);
        return new Rule(type, id, [.. classes], specificity, 0, []);
    }

    private static List<Declaration> ParseDeclarations(string block, SvgReport report)
    {
        var result = new List<Declaration>();
        foreach (var raw in SplitOutside(StripComments(block), ';'))
        {
            var colon = raw.IndexOf(':');
            if (colon <= 0)
            {
                if (raw.Trim().Length > 0) report.Add(SvgReportCodes.UnsupportedCss, raw.Trim());
                continue;
            }
            var property = raw[..colon].Trim().ToLowerInvariant();
            var value = raw[(colon + 1)..].Trim();
            var bang = value.LastIndexOf('!');
            if (bang >= 0 && value[(bang + 1)..].Trim().Equals("important", StringComparison.OrdinalIgnoreCase))
            {
                report.Add(SvgReportCodes.UnsupportedCss, "!important");
                value = value[..bang].Trim();
            }
            if (Properties.Contains(property))
            {
                if (value.Length > 0) result.Add(new Declaration(property, value));
            }
            else
            {
                report.Add(SvgReportCodes.UnsupportedCss, property);
            }
        }
        return result;
    }

    private static string StripComments(string css)
    {
        var sb = new StringBuilder(css.Length);
        var i = 0;
        while (i < css.Length)
        {
            if (i + 1 < css.Length && css[i] == '/' && css[i + 1] == '*')
            {
                var end = css.IndexOf("*/", i + 2, StringComparison.Ordinal);
                i = end < 0 ? css.Length : end + 2;
                sb.Append(' ');
                continue;
            }
            sb.Append(css[i++]);
        }
        return sb.ToString();
    }

    private static int SkipAtRule(string text, int start)
    {
        var semicolon = IndexOutsideStrings(text, start, ';');
        var open = IndexOutsideStrings(text, start, '{');
        if (open >= 0 && (semicolon < 0 || open < semicolon))
        {
            var close = MatchingBrace(text, open);
            return close < 0 ? text.Length : close + 1;
        }
        return semicolon < 0 ? text.Length : semicolon + 1;
    }

    private static int IndexOutsideStrings(string text, int start, char target)
    {
        char quote = '\0';
        for (var i = start; i < text.Length; i++)
        {
            var c = text[i];
            if (quote != '\0') { if (c == quote) quote = '\0'; continue; }
            if (c is '"' or '\'') { quote = c; continue; }
            if (c == target) return i;
        }
        return -1;
    }

    private static int MatchingBrace(string text, int open)
    {
        var depth = 0;
        char quote = '\0';
        for (var i = open; i < text.Length; i++)
        {
            var c = text[i];
            if (quote != '\0') { if (c == quote) quote = '\0'; continue; }
            if (c is '"' or '\'') { quote = c; continue; }
            if (c == '{') depth++;
            else if (c == '}' && --depth == 0) return i;
        }
        return -1;
    }

    private static IEnumerable<string> SplitOutside(string text, char separator)
    {
        var start = 0;
        var depth = 0;
        char quote = '\0';
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quote != '\0') { if (c == quote) quote = '\0'; continue; }
            if (c is '"' or '\'') quote = c;
            else if (c == '(') depth++;
            else if (c == ')') depth = Math.Max(0, depth - 1);
            else if (c == separator && depth == 0)
            {
                yield return text[start..i];
                start = i + 1;
            }
        }
        yield return text[start..];
    }
}

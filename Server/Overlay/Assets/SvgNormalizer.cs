using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace SignalRC.Server.Overlay.Assets;

/// <summary>
/// Steps 3 to 7 of Shared/Overlay/svg/README.md §1 on a parsed tree: CSS,
/// references, allowlist, normalization, parts and limits. Every value in the
/// output is re-serialized from parsed numbers and keywords; no source text is
/// copied except text content.
/// </summary>
internal sealed partial class SvgNormalizer
{
    private static readonly HashSet<string> Shapes = ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"];
    private static readonly HashSet<string> Gradients = ["linearGradient", "radialGradient"];
    private static readonly HashSet<string> Structural =
    [
        "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
        "linearGradient", "radialGradient", "stop", "clipPath", "use", "symbol", "a", "switch",
    ];
    private static readonly HashSet<string> MetadataElements = ["metadata", "title", "desc"];
    private static readonly HashSet<string> RootOnly = ["width", "height", "viewBox", "preserveAspectRatio", "x", "y", "version", "baseProfile", "zoomAndPan", "id"];
    private static readonly HashSet<string> Conditional = ["requiredFeatures", "requiredExtensions", "systemLanguage"];
    private static readonly string[] Presentation =
    [
        "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
        "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity",
        "clip-path", "clip-rule", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "letter-spacing",
    ];

    /// <summary>Output attributes per element in output order (data-part and id come first).</summary>
    private static readonly Dictionary<string, string[]> Allowed = new()
    {
        ["g"] = ["transform", .. Presentation],
        ["path"] = ["d", "transform", .. Presentation],
        ["rect"] = ["x", "y", "width", "height", "rx", "ry", "transform", .. Presentation],
        ["circle"] = ["cx", "cy", "r", "transform", .. Presentation],
        ["ellipse"] = ["cx", "cy", "rx", "ry", "transform", .. Presentation],
        ["line"] = ["x1", "y1", "x2", "y2", "transform", .. Presentation],
        ["polyline"] = ["points", "transform", .. Presentation],
        ["polygon"] = ["points", "transform", .. Presentation],
        ["text"] = ["x", "y", "dx", "dy", "transform", .. Presentation],
        ["tspan"] = ["x", "y", "dx", "dy", .. Presentation],
        ["defs"] = [],
        ["linearGradient"] = ["x1", "y1", "x2", "y2", "gradientUnits", "gradientTransform", "spreadMethod"],
        ["radialGradient"] = ["cx", "cy", "r", "fx", "fy", "fr", "gradientUnits", "gradientTransform", "spreadMethod"],
        ["stop"] = ["offset", "stop-color", "stop-opacity"],
        ["clipPath"] = ["clipPathUnits", "transform"],
    };

    /// <summary>Attributes evaluated elsewhere; dropped without a report entry.</summary>
    private static readonly HashSet<string> Consumed = ["id", "data-part", "color", "display", "visibility", "href"];

    private readonly SvgReport _report;
    private readonly SvgElement _source;
    private readonly SvgElement _content = new("g");
    private readonly List<PendingRef> _refs = [];
    private Dictionary<string, SvgElement> _ids = [];
    private int _elementCount;
    private double _width, _height;
    private bool _sized;
    private SvgMatrix _rootMatrix = SvgMatrix.Identity;
    private LengthContext _lengths;

    private sealed record PendingRef(SvgElement Element, string Attribute, string Target, string? Fallback, bool Clip);

    private readonly record struct Context(string Color, double FontSize, string Anchor, LengthContext Lengths, bool InClip);

    public SvgNormalizer(SvgElement root, SvgReport report)
    {
        _source = root;
        _report = report;
    }

    public sealed record Output(string Svg, JsonObject Metadata);

    public Output Run()
    {
        // data-part keeps part ids stable when a normalized asset is imported again (exchange, D34).
        var order = 0;
        foreach (var e in _source.Descendants())
        {
            e.SourceId = NonEmpty(e.Get("id")) ?? NonEmpty(e.Get("data-part"));
            e.Order = ++order;
        }
        SvgCss.Resolve(_source, _report);
        if (IsHidden(_source)) throw new SvgRejectedException(SvgReportCodes.RejectedEmpty, "svg (display:none)");
        Viewport();
        // The root's presentation attributes and the viewport mapping move to a wrapper group.
        foreach (var (key, value) in _source.Attributes)
        {
            if (!RootOnly.Contains(key)) _content.Attributes.Add(new(key, value));
        }
        if (NormalizedWrapper() is { } wrapper)
        {
            foreach (var (key, value) in wrapper.Attributes) _content.Set(key, value);
            _content.Children.AddRange(wrapper.Children);
        }
        else
        {
            _content.Children.AddRange(_source.Children);
        }
        StripEventHandlers(_content);
        Prune(_content);

        _ids = [];
        foreach (var e in _content.Descendants())
        {
            if (e.SourceId != null) _ids.TryAdd(e.SourceId, e);
        }
        _elementCount = _content.Descendants().Count();
        Expand(_content, [], false, 1);
        HoistDefinitions();
        FlattenGradients();
        RemoveHrefs(_content);

        var ctx = new Context("#000000", 16, "start", _lengths, false);
        NormalizeAttributes(_content, ctx);
        NormalizeChildren(_content, ctx with { Color = CurrentColor(_content, ctx.Color) });
        ResolveReferences();
        AssignParts();

        if (!HasDrawable(_content)) throw new SvgRejectedException(SvgReportCodes.RejectedEmpty, "no visible content");
        if (!_sized)
        {
            var contentBox = Box(_content);
            // Neither viewBox nor width/height: frame the content.
            _width = Math.Max(1, SvgValues.Round(contentBox.MaxX - contentBox.MinX));
            _height = Math.Max(1, SvgValues.Round(contentBox.MaxY - contentBox.MinY));
            _rootMatrix = SvgMatrix.Translate(-contentBox.MinX, -contentBox.MinY);
            if (!SvgNumber.InRange(_width) || !SvgNumber.InRange(_height)) throw new SvgRejectedException(SvgReportCodes.RejectedLimit, "size");
        }
        SetTransform(_content, SvgValues.Rounded(_rootMatrix.Multiply(_content.Matrix)));

        var svg = Serialize();
        CheckLimits(svg);
        return new Output(svg, Metadata());
    }

    private static string? NonEmpty(string? id) => string.IsNullOrWhiteSpace(id) ? null : id.Trim();

    /// <summary>
    /// The root group a previous normalization wrote (no part marker, all
    /// rendered children marked); it is unwrapped so that it does not become a part.
    /// </summary>
    private SvgElement? NormalizedWrapper()
    {
        if (_source.Attributes.Count != 1 || _source.Get("viewBox")?.StartsWith("0 0 ") != true) return null;
        var children = _source.Children.Where(c => c is not SvgTextNode t || t.Text.Trim().Length > 0).ToList();
        if (children is not [SvgElement { Name: "g" } g] || g.SourceId != null) return null;
        var rendered = g.Elements.Where(e => e.Name is not ("defs" or "linearGradient" or "radialGradient" or "clipPath")).ToList();
        return rendered.Count > 0 && rendered.All(e => e.Get("data-part") != null) ? g : null;
    }

    // --- Viewport (step 6, root) ---

    private void Viewport()
    {
        var defaults = new LengthContext(300, 150);
        double? width = RootLength("width", LengthAxis.X, defaults);
        double? height = RootLength("height", LengthAxis.Y, defaults);
        var viewBox = ParseViewBox(_source.Get("viewBox"));
        if (viewBox is { } vb)
        {
            _width = width ?? (height != null ? height.Value * vb.W / vb.H : vb.W);
            _height = height ?? (width != null ? width.Value * vb.H / vb.W : vb.H);
            _rootMatrix = ViewBoxMatrix(vb, _width, _height, _source.Get("preserveAspectRatio"));
            _lengths = new LengthContext(vb.W, vb.H);
            _sized = true;
        }
        else if (width != null && height != null)
        {
            _width = width.Value;
            _height = height.Value;
            _lengths = new LengthContext(_width, _height);
            _sized = true;
        }
        else
        {
            _lengths = defaults;
        }
        _width = SvgValues.Round(_width);
        _height = SvgValues.Round(_height);
        if (_sized && (_width <= 0 || _height <= 0 || !SvgNumber.InRange(_width) || !SvgNumber.InRange(_height)))
        {
            throw new SvgRejectedException(SvgReportCodes.RejectedLimit, "size");
        }
    }

    private double? RootLength(string name, LengthAxis axis, LengthContext ctx)
    {
        var text = _source.Get(name);
        if (text == null || text.Trim().EndsWith('%')) return null;
        var status = SvgValues.Length(text, axis, ctx, out var v);
        if (status == ValueStatus.Converted) _report.Add(SvgReportCodes.UnitConverted, $"{name}={text}");
        return status is ValueStatus.Ok or ValueStatus.Converted && v > 0 ? v : null;
    }

    private readonly record struct ViewBox(double X, double Y, double W, double H);

    private static ViewBox? ParseViewBox(string? text)
    {
        if (text == null || !SvgValues.NumberList(text, out var n) || n.Count != 4 || n[2] <= 0 || n[3] <= 0) return null;
        return new ViewBox(n[0], n[1], n[2], n[3]);
    }

    private static SvgMatrix ViewBoxMatrix(ViewBox vb, double width, double height, string? aspect)
    {
        var tokens = (aspect ?? "").Split((char[])[' ', '\t', '\n', '\r', ','], StringSplitOptions.RemoveEmptyEntries).ToList();
        if (tokens.Count > 0 && tokens[0] == "defer") tokens.RemoveAt(0);
        var align = tokens.Count > 0 ? tokens[0] : "xMidYMid";
        var slice = tokens.Count > 1 && tokens[1] == "slice";
        var sx = width / vb.W;
        var sy = height / vb.H;
        if (align == "none") return SvgMatrix.Scale(sx, sy).Multiply(SvgMatrix.Translate(-vb.X, -vb.Y));
        if (align is not ("xMinYMin" or "xMidYMin" or "xMaxYMin" or "xMinYMid" or "xMidYMid" or "xMaxYMid" or "xMinYMax" or "xMidYMax" or "xMaxYMax"))
        {
            align = "xMidYMid";
        }
        var s = slice ? Math.Max(sx, sy) : Math.Min(sx, sy);
        var dx = align[1..4] switch { "Min" => 0, "Mid" => (width - vb.W * s) / 2, _ => width - vb.W * s };
        var dy = align[5..8] switch { "Min" => 0, "Mid" => (height - vb.H * s) / 2, _ => height - vb.H * s };
        return new SvgMatrix(s, 0, 0, s, dx - vb.X * s, dy - vb.Y * s);
    }

    // --- Allowlist (step 5, structure) ---

    private void StripEventHandlers(SvgElement element)
    {
        foreach (var name in element.Attributes.Select(a => a.Key).Where(k => k.StartsWith("on", StringComparison.OrdinalIgnoreCase)).ToList())
        {
            element.Remove(name);
            _report.Add(SvgReportCodes.RemovedAttribute, name);
        }
    }

    private void Prune(SvgElement parent)
    {
        for (var i = 0; i < parent.Children.Count; i++)
        {
            if (parent.Children[i] is not SvgElement e) continue;
            StripEventHandlers(e);
            var remove = false;
            if (IsHidden(e))
            {
                _report.Add(SvgReportCodes.RemovedElement, $"{e.Name} (display:none)");
                remove = true;
            }
            else if (MetadataElements.Contains(e.Name))
            {
                _report.Add(SvgReportCodes.MetadataRemoved, e.Name);
                remove = true;
            }
            else if (!Structural.Contains(e.Name))
            {
                _report.Add(SvgReportCodes.RemovedElement, e.Name);
                remove = true;
            }
            else if (e.Name == "a")
            {
                e.Name = "g";
                if (e.Remove("href")) _report.Add(SvgReportCodes.RemovedAttribute, "a href");
                e.Remove("target");
            }
            else if (e.Name == "switch")
            {
                // Rendered like a browser without extensions: the first child without test attributes.
                e.Name = "g";
                var chosen = e.Elements.FirstOrDefault(c => !c.Attributes.Any(a => Conditional.Contains(a.Key)));
                foreach (var alternative in e.Elements.Where(c => c != chosen)) _report.Add(SvgReportCodes.RemovedElement, $"switch > {alternative.Name}");
                e.Children.RemoveAll(c => c is SvgElement && c != chosen);
                chosen?.Attributes.RemoveAll(a => Conditional.Contains(a.Key));
            }
            if (remove)
            {
                parent.Children.RemoveAt(i--);
                continue;
            }
            foreach (var name in Conditional) if (e.Remove(name)) _report.Add(SvgReportCodes.RemovedAttribute, name);
            Prune(e);
        }
    }

    private static bool IsHidden(SvgElement e)
    {
        var display = e.Get("display")?.Trim().ToLowerInvariant();
        var visibility = e.Get("visibility")?.Trim().ToLowerInvariant();
        return display == "none" || visibility is "hidden" or "collapse";
    }

    // --- References (step 4) ---

    private void Expand(SvgElement parent, HashSet<string> active, bool inClip, int depth)
    {
        if (depth > SvgLimits.MaxRawDepth) throw new SvgRejectedException(SvgReportCodes.RejectedLimit, $"depth > {SvgLimits.MaxRawDepth}");
        for (var i = 0; i < parent.Children.Count; i++)
        {
            if (parent.Children[i] is not SvgElement e) continue;
            if (e.Name == "use")
            {
                var replacement = ExpandUse(e, active, inClip, depth);
                if (replacement == null) parent.Children.RemoveAt(i--);
                else parent.Children[i] = replacement;
                continue;
            }
            // Symbols and plain definitions only render through a use; their uses expand with the clone.
            if (e.Name == "symbol" || (parent.Name == "defs" && e.Name != "clipPath"))
            {
                // Clip paths in there are hoisted later and need their uses expanded.
                ExpandClipPaths(e, active, depth + 1);
                continue;
            }
            Expand(e, active, inClip || e.Name == "clipPath", depth + 1);
        }
    }

    private void ExpandClipPaths(SvgElement container, HashSet<string> active, int depth)
    {
        foreach (var child in container.Elements)
        {
            if (child.Name == "clipPath") Expand(child, active, true, depth + 1);
            else ExpandClipPaths(child, active, depth + 1);
        }
    }

    private SvgElement? ExpandUse(SvgElement use, HashSet<string> active, bool inClip, int depth)
    {
        var href = use.Get("href")?.Trim();
        if (href == null || href.Length == 0)
        {
            _report.Add(SvgReportCodes.RemovedElement, "use");
            return null;
        }
        if (!href.StartsWith('#'))
        {
            _report.Add(SvgReportCodes.ExternalReference, href);
            return null;
        }
        var id = href[1..];
        if (!_ids.TryGetValue(id, out var target) || target.Name is "linearGradient" or "radialGradient" or "stop" or "clipPath" or "defs")
        {
            _report.Add(SvgReportCodes.RemovedElement, $"use {href}");
            return null;
        }
        if (active.Contains(id)) throw new SvgRejectedException(SvgReportCodes.RejectedUseCycle, href);

        var clone = (SvgElement)target.Clone();
        MarkClone(clone);
        _elementCount += 1 + clone.Descendants().Count();
        if (_elementCount > SvgLimits.MaxExpandedElements)
        {
            throw new SvgRejectedException(SvgReportCodes.RejectedLimit, $"elements > {SvgLimits.MaxElements} (use)");
        }

        var matrix = ParseTransform(use, "transform").Multiply(SvgMatrix.Translate(UseLength(use, "x", LengthAxis.X), UseLength(use, "y", LengthAxis.Y)));
        SvgElement content = clone;
        if (target.Name == "symbol")
        {
            content = new SvgElement("g") { IsClone = true };
            foreach (var (key, value) in clone.Attributes)
            {
                if (key is not ("viewBox" or "preserveAspectRatio" or "x" or "y" or "width" or "height" or "refX" or "refY")) content.Attributes.Add(new(key, value));
            }
            content.Children.AddRange(clone.Children);
            if (ParseViewBox(clone.Get("viewBox")) is { } vb)
            {
                var w = use.Get("width") != null ? UseLength(use, "width", LengthAxis.X) : _lengths.Width;
                var h = use.Get("height") != null ? UseLength(use, "height", LengthAxis.Y) : _lengths.Height;
                if (w <= 0 || h <= 0) return null;
                matrix = matrix.Multiply(ViewBoxMatrix(vb, w, h, clone.Get("preserveAspectRatio")));
            }
        }

        if (inClip)
        {
            // clipPath children must be shapes or text; a group cannot be represented there.
            if (!Shapes.Contains(content.Name) && content.Name != "text")
            {
                _report.Add(SvgReportCodes.RemovedElement, $"clipPath > use {href}");
                return null;
            }
            SetTransform(content, matrix.Multiply(ParseTransform(content, "transform")));
            foreach (var (key, value) in use.Attributes)
            {
                if (Presentation.Contains(key) && content.Get(key) == null) content.Set(key, value);
            }
            return content;
        }

        var wrapper = new SvgElement("g") { SourceId = use.SourceId, IsClone = use.IsClone };
        foreach (var (key, value) in use.Attributes)
        {
            if (key is not ("href" or "x" or "y" or "width" or "height" or "transform")) wrapper.Attributes.Add(new(key, value));
        }
        if (!matrix.IsIdentity) SetTransform(wrapper, matrix);
        wrapper.Children.Add(content);
        active.Add(id);
        Expand(wrapper, active, false, depth + 1);
        active.Remove(id);
        return wrapper;
    }

    private static void MarkClone(SvgElement element)
    {
        element.IsClone = true;
        element.SourceId = null;
        element.Remove("id");
        // Definitions stay with the original; copies would only duplicate them.
        element.Children.RemoveAll(c => c is SvgElement { Name: "linearGradient" or "radialGradient" or "clipPath" });
        foreach (var child in element.Elements) MarkClone(child);
    }

    private double UseLength(SvgElement use, string name, LengthAxis axis)
    {
        var text = use.Get(name);
        if (text == null) return 0;
        var status = SvgValues.Length(text, axis, _lengths, out var v);
        if (status == ValueStatus.Converted) _report.Add(SvgReportCodes.UnitConverted, $"{name}={text}");
        return status is ValueStatus.Ok or ValueStatus.Converted ? v : 0;
    }

    private SvgMatrix ParseTransform(SvgElement element, string name)
    {
        var text = element.Get(name);
        if (text == null) return SvgMatrix.Identity;
        if (SvgValues.Transform(text) is { } m) return m;
        _report.Add(SvgReportCodes.RemovedAttribute, $"{name}={text}");
        return SvgMatrix.Identity;
    }

    /// <summary>Composed transforms (use, viewport) must stay within the number range; otherwise the file is rejected.</summary>
    private static void SetTransform(SvgElement element, SvgMatrix matrix)
    {
        if (!new[] { matrix.A, matrix.B, matrix.C, matrix.D, matrix.E, matrix.F }.All(SvgNumber.InRange))
        {
            throw new SvgRejectedException(SvgReportCodes.RejectedLimit, "transform out of range");
        }
        element.Remove("transform");
        if (!matrix.IsIdentity) element.Attributes.Insert(0, new("transform", SvgValues.FormatTransform(matrix)));
    }

    /// <summary>Symbols and unused definitions are not rendered; gradients and clip paths inside them move to a defs.</summary>
    private void HoistDefinitions()
    {
        var hoisted = new List<SvgElement>();
        Visit(_content);
        if (hoisted.Count > 0)
        {
            var defs = new SvgElement("defs");
            defs.Children.AddRange(hoisted);
            _content.Children.Insert(0, defs);
        }

        void Visit(SvgElement parent)
        {
            for (var i = 0; i < parent.Children.Count; i++)
            {
                if (parent.Children[i] is not SvgElement e) continue;
                var drop = e.Name == "symbol" || (parent.Name == "defs" && e.Name is not ("linearGradient" or "radialGradient" or "clipPath"));
                if (drop)
                {
                    Collect(e, hoisted);
                    parent.Children.RemoveAt(i--);
                }
                else if (e.Name is not ("clipPath" or "linearGradient" or "radialGradient"))
                {
                    Visit(e);
                }
            }
        }

        static void Collect(SvgElement e, List<SvgElement> into)
        {
            foreach (var child in e.Elements)
            {
                if (child.Name is "linearGradient" or "radialGradient" or "clipPath") into.Add(child);
                else Collect(child, into);
            }
        }
    }

    private const int MaxGradientChain = 64;

    /// <summary>Resolves gradient href chains iteratively (bounded) and copies inherited attributes and stops.</summary>
    private void FlattenGradients()
    {
        var done = new HashSet<SvgElement>();
        foreach (var g in _content.Descendants().Where(e => Gradients.Contains(e.Name) && !e.IsClone).ToList())
        {
            if (done.Contains(g)) continue;
            var chain = new List<SvgElement> { g };
            while (true)
            {
                var current = chain[^1];
                if (done.Contains(current)) break;
                var href = current.Get("href")?.Trim();
                current.Remove("href");
                if (href == null) break;
                if (!href.StartsWith('#'))
                {
                    _report.Add(SvgReportCodes.ExternalReference, href);
                    break;
                }
                if (!_ids.TryGetValue(href[1..], out var template) || !Gradients.Contains(template.Name))
                {
                    _report.Add(SvgReportCodes.RemovedAttribute, $"{current.Name} href {href}");
                    break;
                }
                if (chain.Contains(template))
                {
                    _report.Add(SvgReportCodes.RemovedAttribute, $"{current.Name} href {href} (cycle)");
                    break;
                }
                if (chain.Count >= MaxGradientChain) throw new SvgRejectedException(SvgReportCodes.RejectedLimit, $"gradient href chain > {MaxGradientChain}");
                chain.Add(template);
            }
            // The last element is resolved; inherit towards the start.
            for (var i = chain.Count - 2; i >= 0; i--) Inherit(chain[i], chain[i + 1]);
            done.UnionWith(chain);
        }
    }

    private void Inherit(SvgElement g, SvgElement template)
    {
        string[] inherited = template.Name == g.Name
            ? (g.Name == "linearGradient" ? ["x1", "y1", "x2", "y2"] : ["cx", "cy", "r", "fx", "fy", "fr"])
            : [];
        foreach (var name in inherited.Concat(["gradientUnits", "gradientTransform", "spreadMethod"]))
        {
            if (g.Get(name) == null && template.Get(name) is { } value) g.Set(name, value);
        }
        if (g.Elements.Any(c => c.Name == "stop")) return;
        var stops = template.Elements.Where(c => c.Name == "stop").ToList();
        if (stops.Count > SvgLimits.MaxStopsPerGradient) throw new SvgRejectedException(SvgReportCodes.RejectedLimit, $"stops {stops.Count} > {SvgLimits.MaxStopsPerGradient}");
        _elementCount += stops.Count;
        if (_elementCount > SvgLimits.MaxExpandedElements) throw new SvgRejectedException(SvgReportCodes.RejectedLimit, $"elements > {SvgLimits.MaxElements} (gradient href)");
        foreach (var stop in stops) g.Children.Add(stop.Clone());
    }

    private void RemoveHrefs(SvgElement element)
    {
        if (element.Get("href") is { } href)
        {
            element.Remove("href");
            _report.Add(href.Trim().StartsWith('#') ? SvgReportCodes.RemovedAttribute : SvgReportCodes.ExternalReference, href.Trim().StartsWith('#') ? $"{element.Name} href" : href);
        }
        foreach (var child in element.Elements) RemoveHrefs(child);
    }

    // --- Normalization (step 6) ---

    private static bool AllowedChild(string parent, string child) => parent switch
    {
        "g" => child is "g" or "defs" or "text" or "linearGradient" or "radialGradient" or "clipPath" || Shapes.Contains(child),
        "defs" => child is "linearGradient" or "radialGradient" or "clipPath",
        "clipPath" => child == "text" || Shapes.Contains(child),
        "linearGradient" or "radialGradient" => child == "stop",
        "text" or "tspan" => child == "tspan",
        _ => false,
    };

    private void NormalizeChildren(SvgElement parent, Context ctx)
    {
        var isText = parent.Name is "text" or "tspan";
        for (var i = 0; i < parent.Children.Count; i++)
        {
            switch (parent.Children[i])
            {
                case SvgTextNode t:
                    if (!isText) parent.Children.RemoveAt(i--);
                    else t.Text = CollapseWhitespace(t.Text);
                    break;
                case SvgElement e:
                    if (!AllowedChild(parent.Name, e.Name) || !Allowed.ContainsKey(e.Name))
                    {
                        // Unused shapes inside defs never rendered; everything else is reported.
                        if (parent.Name != "defs") _report.Add(SvgReportCodes.RemovedElement, $"{parent.Name} > {e.Name}");
                        parent.Children.RemoveAt(i--);
                        break;
                    }
                    var childCtx = ctx with { InClip = ctx.InClip || e.Name == "clipPath" };
                    if (!NormalizeAttributes(e, childCtx))
                    {
                        parent.Children.RemoveAt(i--);
                        break;
                    }
                    childCtx = ChildContext(e, childCtx);
                    NormalizeChildren(e, childCtx);
                    if (e.Name == "text" && !FinishText(e)) parent.Children.RemoveAt(i--);
                    else if (e.Name == "text") e.Box = TextBox(e, childCtx);
                    break;
            }
        }
    }

    private Context ChildContext(SvgElement e, Context ctx)
    {
        var next = ctx with { Color = CurrentColor(e, ctx.Color) };
        if (e.Get("font-size") is { } size && SvgValues.Number(size, out var fs)) next = next with { FontSize = fs };
        if (e.Get("text-anchor") is { } anchor) next = next with { Anchor = anchor };
        if (Gradients.Contains(e.Name))
        {
            next = next with { Lengths = e.Get("gradientUnits") == "userSpaceOnUse" ? _lengths : _lengths with { BoundingBoxUnits = true } };
        }
        if (e.Name == "clipPath")
        {
            next = next with { Lengths = e.Get("clipPathUnits") == "objectBoundingBox" ? _lengths with { BoundingBoxUnits = true } : _lengths };
        }
        return next;
    }

    private string CurrentColor(SvgElement e, string inherited)
    {
        var color = e.Get("color");
        e.Remove("color");
        return color != null && SvgValues.Color(color, inherited) is { } c ? c : inherited;
    }

    private static string CollapseWhitespace(string text)
    {
        var sb = new StringBuilder(text.Length);
        var space = false;
        foreach (var c in text)
        {
            if (c is '\r' or '\n') continue;
            if (c is ' ' or '\t')
            {
                if (!space) sb.Append(' ');
                space = true;
                continue;
            }
            sb.Append(c);
            space = false;
        }
        return sb.ToString();
    }

    /// <summary>Trims the text element's outer whitespace; false when no characters remain.</summary>
    private static bool FinishText(SvgElement text)
    {
        var nodes = new List<(SvgElement Parent, SvgTextNode Node)>();
        Collect(text);
        // Trimmed up to the first and last visible character, so a second pass changes nothing.
        foreach (var (_, node) in nodes)
        {
            node.Text = node.Text.TrimStart(' ');
            if (node.Text.Length > 0) break;
        }
        for (var i = nodes.Count - 1; i >= 0; i--)
        {
            nodes[i].Node.Text = nodes[i].Node.Text.TrimEnd(' ');
            if (nodes[i].Node.Text.Length > 0) break;
        }
        foreach (var (parent, node) in nodes.Where(n => n.Node.Text.Length == 0)) parent.Children.Remove(node);
        RemoveEmptyTspans(text);
        return nodes.Any(n => n.Node.Text.Length > 0);

        void Collect(SvgElement e)
        {
            foreach (var child in e.Children)
            {
                if (child is SvgTextNode t) nodes.Add((e, t));
                else if (child is SvgElement c) Collect(c);
            }
        }

        static void RemoveEmptyTspans(SvgElement e)
        {
            foreach (var child in e.Elements.ToList())
            {
                RemoveEmptyTspans(child);
                if (child.Children.Count == 0) e.Children.Remove(child);
            }
        }
    }

    /// <summary>Rewrites the element's attributes in canonical order; false when the element renders nothing.</summary>
    private bool NormalizeAttributes(SvgElement e, Context ctx)
    {
        var allowed = Allowed[e.Name];
        var source = e.Attributes.ToDictionary(a => a.Key, a => a.Value);
        foreach (var key in source.Keys)
        {
            if (!allowed.Contains(key) && !Consumed.Contains(key)) _report.Add(SvgReportCodes.RemovedAttribute, key);
        }
        e.Attributes.Clear();
        var current = source.TryGetValue("color", out var colorText) && SvgValues.Color(colorText, ctx.Color) is { } own ? own : ctx.Color;
        if (source.TryGetValue("color", out var keepColor)) e.Attributes.Add(new("color", keepColor));
        var lengths = ctx.Lengths;
        if (Gradients.Contains(e.Name))
        {
            lengths = source.GetValueOrDefault("gradientUnits")?.Trim() == "userSpaceOnUse" ? _lengths : _lengths with { BoundingBoxUnits = true };
        }

        foreach (var name in allowed)
        {
            if (!source.TryGetValue(name, out var raw)) continue;
            var value = Value(e, name, raw, current, lengths, ctx);
            if (value != null) e.Attributes.Add(new(name, value));
        }
        // The current color must stay readable for the children until ChildContext consumes it.
        return HasGeometry(e);
    }

    private string? Value(SvgElement e, string name, string raw, string current, LengthContext lengths, Context ctx)
    {
        var text = raw.Trim();
        if (text.Equals("inherit", StringComparison.OrdinalIgnoreCase)) return null;
        switch (name)
        {
            case "transform":
            case "gradientTransform":
            {
                if (SvgValues.Transform(text) is not { } m) return Invalid(e, name, raw);
                var rounded = SvgValues.Rounded(m);
                if (name == "transform") e.Matrix = rounded;
                return rounded.IsIdentity ? null : SvgValues.FormatTransform(rounded);
            }
            case "d":
            {
                var path = SvgValues.Path(text);
                if (path.Truncated) _report.Add(SvgReportCodes.RemovedAttribute, $"d (invalid after {path.D.Length} chars)");
                if (path.D.Length == 0) return null;
                e.Box = path.Box;
                e.Points = path.Points;
                return path.D;
            }
            case "points":
            {
                if (!SvgValues.NumberList(text, out var numbers)) return Invalid(e, name, raw);
                if (numbers.Count % 2 == 1) numbers.RemoveAt(numbers.Count - 1);
                if (numbers.Count < 4) return null;
                var box = new SvgBox();
                var sb = new StringBuilder();
                for (var i = 0; i < numbers.Count; i += 2)
                {
                    var x = SvgValues.Round(numbers[i]);
                    var y = SvgValues.Round(numbers[i + 1]);
                    if (i > 0) sb.Append(' ');
                    sb.Append(SvgNumber.Format(x)).Append(' ').Append(SvgNumber.Format(y));
                    box.Add(x, y);
                }
                e.Box = box;
                e.Points = numbers.Count / 2;
                return sb.ToString();
            }
            case "x" or "y" or "dx" or "dy" when e.Name is "text" or "tspan":
            {
                var status = SvgValues.LengthList(text, name is "x" or "dx" ? LengthAxis.X : LengthAxis.Y, lengths, out var list);
                if (!Accept(e, name, raw, status)) return null;
                // Glyph positions count towards the coordinate limit like points.
                e.Points += (list.Count + 1) / 2;
                return string.Join(' ', list.Select(v => SvgNumber.Format(SvgValues.Round(v))));
            }
            case "x" or "x1" or "x2" or "cx" or "fx":
                return LengthValue(e, name, raw, LengthAxis.X, lengths, allowNegative: true);
            case "y" or "y1" or "y2" or "cy" or "fy":
                return LengthValue(e, name, raw, LengthAxis.Y, lengths, allowNegative: true);
            case "width" or "rx":
                return LengthValue(e, name, raw, LengthAxis.X, lengths, allowNegative: false);
            case "height" or "ry":
                return LengthValue(e, name, raw, LengthAxis.Y, lengths, allowNegative: false);
            case "r" or "fr":
                return LengthValue(e, name, raw, LengthAxis.Other, lengths, allowNegative: false);
            case "stroke-width":
            case "stroke-dashoffset":
                return LengthValue(e, name, raw, LengthAxis.Other, _lengths, allowNegative: name == "stroke-dashoffset");
            case "font-size":
                return LengthValue(e, name, raw, LengthAxis.Other, _lengths, allowNegative: false, positive: true);
            case "letter-spacing":
                return text == "normal" ? null : LengthValue(e, name, raw, LengthAxis.X, _lengths, allowNegative: true);
            case "stroke-dasharray":
            {
                if (text == "none") return "none";
                var status = SvgValues.LengthList(text, LengthAxis.Other, _lengths, out var list);
                if (!Accept(e, name, raw, status)) return null;
                if (list.Any(v => v < 0)) return Invalid(e, name, raw);
                return list.All(v => v == 0) ? "none" : string.Join(' ', list.Select(v => SvgNumber.Format(SvgValues.Round(v))));
            }
            case "stroke-miterlimit":
                return SvgValues.Number(text, out var limit) && limit >= 1 ? SvgNumber.Format(SvgValues.Round(limit)) : Invalid(e, name, raw);
            case "opacity" or "fill-opacity" or "stroke-opacity" or "stop-opacity" or "offset":
                return SvgValues.Fraction(text, out var fraction) ? SvgNumber.Format(SvgValues.Round(fraction)) : Invalid(e, name, raw);
            case "fill" or "stroke":
                return Paint(e, name, text, current, ctx);
            case "stop-color":
                return SvgValues.Color(text, current) ?? Invalid(e, name, raw);
            case "clip-path":
            {
                if (text == "none") return null;
                if (ctx.InClip) return Invalid(e, name, raw);
                var url = SvgValues.Url(text);
                if (url == null) return Invalid(e, name, raw);
                if (!url.Value.Target.StartsWith('#'))
                {
                    _report.Add(SvgReportCodes.ExternalReference, url.Value.Target);
                    return null;
                }
                _refs.Add(new PendingRef(e, name, url.Value.Target[1..], null, true));
                return "url(#)";
            }
            case "font-family":
            {
                var mapped = SvgValues.FontFamily(text);
                var first = text.Split(',')[0].Trim().Trim('"', '\'').Trim();
                if (!first.Equals(mapped, StringComparison.OrdinalIgnoreCase)) _report.Add(SvgReportCodes.FontMapped, $"{first} → {mapped}");
                return mapped;
            }
            case "font-weight":
            {
                var lower = text.ToLowerInvariant();
                if (lower is "normal" or "bold" or "bolder" or "lighter") return lower;
                return int.TryParse(text, out var w) && w is >= 1 and <= 1000 ? w.ToString() : Invalid(e, name, raw);
            }
            default:
            {
                var lower = text.ToLowerInvariant();
                var keyword = (name, lower) switch
                {
                    ("fill-rule" or "clip-rule", "nonzero" or "evenodd") => lower,
                    ("stroke-linecap", "butt" or "round" or "square") => lower,
                    ("stroke-linejoin", "miter" or "round" or "bevel") => lower,
                    ("stroke-linejoin", "miter-clip" or "arcs") => "miter",
                    ("font-style", "normal" or "italic" or "oblique") => lower,
                    ("text-anchor", "start" or "middle" or "end") => lower,
                    ("gradientUnits" or "clipPathUnits", _) when text is "userSpaceOnUse" or "objectBoundingBox" => text,
                    ("spreadMethod", "pad" or "reflect" or "repeat") => lower,
                    _ => null,
                };
                return keyword ?? Invalid(e, name, raw);
            }
        }
    }

    private string? Paint(SvgElement e, string name, string text, string current, Context ctx)
    {
        if (text.Equals("none", StringComparison.OrdinalIgnoreCase)) return "none";
        if (SvgValues.Url(text) is { } url)
        {
            string? fallback = null;
            if (url.Fallback != null) fallback = url.Fallback.Equals("none", StringComparison.OrdinalIgnoreCase) ? "none" : SvgValues.Color(url.Fallback, current);
            if (!url.Target.StartsWith('#'))
            {
                _report.Add(SvgReportCodes.ExternalReference, url.Target);
                return fallback ?? "none";
            }
            // Paint servers do not matter for clipping geometry.
            if (ctx.InClip) return null;
            _refs.Add(new PendingRef(e, name, url.Target[1..], fallback, false));
            return "url(#)";
        }
        return SvgValues.Color(text, current) ?? Invalid(e, name, text);
    }

    private string? LengthValue(SvgElement e, string name, string raw, LengthAxis axis, LengthContext lengths, bool allowNegative, bool positive = false)
    {
        var status = SvgValues.Length(raw, axis, lengths, out var v);
        if (!Accept(e, name, raw, status)) return null;
        v = SvgValues.Round(v);
        if ((!allowNegative && v < 0) || (positive && v <= 0)) return Invalid(e, name, raw);
        return SvgNumber.Format(v);
    }

    private bool Accept(SvgElement e, string name, string raw, ValueStatus status)
    {
        switch (status)
        {
            case ValueStatus.Ok:
                return true;
            case ValueStatus.Converted:
                _report.Add(SvgReportCodes.UnitConverted, $"{name}={raw.Trim()}");
                return true;
            default:
                Invalid(e, name, raw);
                return false;
        }
    }

    private string? Invalid(SvgElement e, string name, string raw)
    {
        _report.Add(SvgReportCodes.RemovedAttribute, $"{name}={raw.Trim()}");
        return null;
    }

    private static double Num(SvgElement e, string name, double fallback = 0) =>
        e.Get(name) is { } v && SvgValues.Number(v, out var n) ? n : fallback;

    /// <summary>Shapes that render nothing are dropped; their local box is stored for the parts.</summary>
    private static bool HasGeometry(SvgElement e)
    {
        switch (e.Name)
        {
            case "path":
                return e.Get("d") != null;
            case "polyline":
            case "polygon":
                return e.Get("points") != null;
            case "rect":
            {
                double x = Num(e, "x"), y = Num(e, "y"), w = Num(e, "width"), h = Num(e, "height");
                if (w <= 0 || h <= 0) return false;
                e.Box = Box(x, y, x + w, y + h);
                return true;
            }
            case "circle":
            {
                double cx = Num(e, "cx"), cy = Num(e, "cy"), r = Num(e, "r");
                if (r <= 0) return false;
                e.Box = Box(cx - r, cy - r, cx + r, cy + r);
                return true;
            }
            case "ellipse":
            {
                double cx = Num(e, "cx"), cy = Num(e, "cy");
                var rx = e.Get("rx") != null ? Num(e, "rx") : Num(e, "ry");
                var ry = e.Get("ry") != null ? Num(e, "ry") : rx;
                if (rx <= 0 || ry <= 0) return false;
                e.Box = Box(cx - rx, cy - ry, cx + rx, cy + ry);
                return true;
            }
            case "line":
                e.Box = Box(Num(e, "x1"), Num(e, "y1"), Num(e, "x2"), Num(e, "y2"));
                return true;
            default:
                return true;
        }
    }

    private static SvgBox Box(double x1, double y1, double x2, double y2)
    {
        var box = new SvgBox();
        box.Add(x1, y1);
        box.Add(x2, y2);
        return box;
    }

    /// <summary>Rough text extent: 0.6 em per character, ascent 1 em, descent 0.25 em.</summary>
    private static SvgBox TextBox(SvgElement text, Context ctx)
    {
        var box = new SvgBox();
        var x = First(text, "x");
        var y = First(text, "y");
        Add(text, x, y, ctx.FontSize, ctx.Anchor, true);
        return box;

        void Add(SvgElement e, double px, double py, double size, string anchor, bool whole)
        {
            var chars = whole ? Chars(e) : e.Children.OfType<SvgTextNode>().Sum(t => t.Text.Length);
            var width = chars * 0.6 * size;
            var left = anchor switch { "middle" => px - width / 2, "end" => px - width, _ => px };
            box.Add(left, py - size);
            box.Add(left + width, py + 0.25 * size);
            foreach (var span in e.Elements)
            {
                var spanSize = span.Get("font-size") is { } fs && SvgValues.Number(fs, out var s) ? s : size;
                var spanAnchor = span.Get("text-anchor") ?? anchor;
                if (span.Get("x") != null || span.Get("y") != null)
                {
                    Add(span, span.Get("x") != null ? First(span, "x") : px, span.Get("y") != null ? First(span, "y") : py, spanSize, spanAnchor, true);
                }
                else if (spanSize > size)
                {
                    Add(span, px, py, spanSize, spanAnchor, true);
                }
            }
        }

        static double First(SvgElement e, string name) =>
            e.Get(name) is { } v && SvgValues.NumberList(v, out var list) && list.Count > 0 ? list[0] : 0;
    }

    private static int Chars(SvgElement e) =>
        e.Children.Sum(c => c is SvgTextNode t ? t.Text.Length : c is SvgElement child ? Chars(child) : 0);

    // --- Internal references ---

    private void ResolveReferences()
    {
        _attached = [.. _content.Descendants()];
        var definitions = new Dictionary<string, SvgElement>();
        // First in source order wins, as in a browser, also for definitions hoisted out of symbols.
        foreach (var e in _content.Descendants().OrderBy(d => d.Order))
        {
            if ((Gradients.Contains(e.Name) || e.Name == "clipPath") && !e.IsClone && e.SourceId != null) definitions.TryAdd(e.SourceId, e);
        }
        var used = new HashSet<SvgElement>();
        foreach (var r in _refs)
        {
            var ok = definitions.TryGetValue(r.Target, out var target) && (r.Clip ? target!.Name == "clipPath" : target!.Name != "clipPath") && Attached(r.Element);
            if (ok)
            {
                used.Add(target!);
                continue;
            }
            if (!Attached(r.Element)) continue;
            _report.Add(SvgReportCodes.RemovedAttribute, $"{r.Attribute}=url(#{r.Target})");
            if (r.Clip) r.Element.Remove(r.Attribute);
            else r.Element.Set(r.Attribute, r.Fallback ?? "none");
        }
        // Definitions nobody refers to are dropped, the others numbered in document order.
        RemoveUnused(_content, used);
        var n = 0;
        foreach (var e in _content.Descendants())
        {
            if (used.Contains(e)) e.RefId = "r" + ++n;
        }
        foreach (var r in _refs)
        {
            if (definitions.TryGetValue(r.Target, out var target) && used.Contains(target) && Attached(r.Element) && r.Element.Get(r.Attribute) == "url(#)")
            {
                r.Element.Set(r.Attribute, $"url(#{target.RefId})");
            }
        }
    }

    private bool Attached(SvgElement element) => _attached.Contains(element);

    private HashSet<SvgElement> _attached = [];

    private void RemoveUnused(SvgElement parent, HashSet<SvgElement> used)
    {
        parent.Children.RemoveAll(c => c is SvgElement e && (Gradients.Contains(e.Name) || e.Name == "clipPath") && !used.Contains(e));
        foreach (var child in parent.Elements) RemoveUnused(child, used);
        parent.Children.RemoveAll(c => c is SvgElement { Name: "defs", Children.Count: 0 });
    }

    // --- Parts (§4) ---

    [GeneratedRegex("[^A-Za-z0-9_-]")]
    private static partial Regex InvalidPartChars();

    private void AssignParts()
    {
        var taken = new HashSet<string>();
        var generated = 0;
        foreach (var child in _content.Elements.ToList()) Visit(child, true);

        void Visit(SvgElement e, bool rootChild)
        {
            if (e.Name is "defs" or "clipPath" or "linearGradient" or "radialGradient") return;
            if (e.Name is "g" or "text" || Shapes.Contains(e.Name))
            {
                string? name = null;
                if (!e.IsClone && e.SourceId != null) name = Sanitize(e.SourceId);
                else if (rootChild) name = "part-" + ++generated;
                if (name != null) e.PartId = Unique(name);
            }
            if (e.Name == "text") return;
            foreach (var child in e.Elements) Visit(child, false);
        }

        string Unique(string name)
        {
            var candidate = name;
            for (var k = 2; !taken.Add(candidate); k++)
            {
                var suffix = "-" + k;
                candidate = (name.Length + suffix.Length > 64 ? name[..(64 - suffix.Length)] : name) + suffix;
            }
            return candidate;
        }

        static string Sanitize(string id)
        {
            var s = InvalidPartChars().Replace(id, "_");
            if (s.Length > 64) s = s[..64];
            return s.Length == 0 ? "part" : s;
        }
    }

    // --- Boxes and metadata ---

    private SvgBox Box(SvgElement e, bool includeOwnTransform = true)
    {
        SvgBox local;
        if (e.Name == "g")
        {
            local = new SvgBox();
            foreach (var child in e.Elements)
            {
                if (child.Name is "defs" or "clipPath" or "linearGradient" or "radialGradient") continue;
                local.Add(Box(child));
            }
        }
        else
        {
            local = e.Box ?? new SvgBox();
        }
        return includeOwnTransform ? local.Transform(e.Matrix) : local;
    }

    private static bool HasDrawable(SvgElement e) => e.Elements.Any(c => c.Name switch
    {
        "defs" or "clipPath" or "linearGradient" or "radialGradient" => false,
        "g" => HasDrawable(c),
        _ => true,
    });

    private JsonObject Metadata()
    {
        var parts = new JsonObject();
        foreach (var e in _content.Descendants().Where(d => d.PartId != null))
        {
            var box = Box(e);
            var part = new JsonObject
            {
                ["tag"] = e.Name,
                ["bbox"] = box.HasValue
                    ? new JsonArray(R(box.MinX), R(box.MinY), R(box.MaxX - box.MinX), R(box.MaxY - box.MinY))
                    : new JsonArray(0, 0, 0, 0),
            };
            if (e.Get("fill") is { } fill && !fill.StartsWith("url(")) part["fill"] = fill;
            if (e.Get("stroke") is { } stroke && !stroke.StartsWith("url(")) part["stroke"] = stroke;
            if (e.Get("stroke-width") is { } sw && SvgValues.Number(sw, out var w)) part["strokeWidth"] = w;
            parts[e.PartId!] = part;
        }
        return new JsonObject { ["width"] = _width, ["height"] = _height, ["parts"] = parts };

        static JsonNode R(double v) => SvgValues.Round(v);
    }

    // --- Serialization and limits (steps 7, 8) ---

    private string Serialize()
    {
        var sb = new StringBuilder();
        sb.Append("<svg xmlns=\"").Append(SvgParser.SvgNamespace).Append("\" viewBox=\"0 0 ")
            .Append(SvgNumber.Format(_width)).Append(' ').Append(SvgNumber.Format(_height)).Append("\">");
        // Without attributes the wrapper adds nothing.
        var children = _content.Attributes.Count == 0 ? _content.Children : [_content];
        foreach (var child in children) Write(sb, child);
        sb.Append("</svg>");
        return sb.ToString();
    }

    private static void Write(StringBuilder sb, SvgNode node)
    {
        if (node is SvgTextNode t)
        {
            Escape(sb, t.Text);
            return;
        }
        var e = (SvgElement)node;
        sb.Append('<').Append(e.Name);
        if (e.PartId != null) Attribute(sb, "data-part", e.PartId);
        if (e.RefId != null) Attribute(sb, "id", e.RefId);
        foreach (var (key, value) in e.Attributes) Attribute(sb, key, value);
        if (e.Children.Count == 0)
        {
            sb.Append("/>");
            return;
        }
        sb.Append('>');
        foreach (var child in e.Children) Write(sb, child);
        sb.Append("</").Append(e.Name).Append('>');
    }

    private static void Attribute(StringBuilder sb, string name, string value)
    {
        sb.Append(' ').Append(name).Append("=\"");
        Escape(sb, value);
        sb.Append('"');
    }

    private static void Escape(StringBuilder sb, string text)
    {
        foreach (var c in text)
        {
            sb.Append(c switch
            {
                '&' => "&amp;",
                '<' => "&lt;",
                '>' => "&gt;",
                '"' => "&quot;",
                _ => c.ToString(),
            });
        }
    }

    private void CheckLimits(string svg)
    {
        var violations = new List<string>();
        var all = _content.Descendants().ToList();
        var elements = 1 + (_content.Attributes.Count == 0 ? 0 : 1) + all.Count;
        if (elements > SvgLimits.MaxElements) violations.Add($"elements {elements} > {SvgLimits.MaxElements}");
        var depth = Depth(_content) + (_content.Attributes.Count == 0 ? 0 : 1);
        if (depth > SvgLimits.MaxDepth) violations.Add($"depth {depth} > {SvgLimits.MaxDepth}");
        var coordinates = all.Sum(e => e.Points);
        if (coordinates > SvgLimits.MaxCoordinates) violations.Add($"coordinates {coordinates} > {SvgLimits.MaxCoordinates}");
        var definitions = all.Count(e => Gradients.Contains(e.Name) || e.Name == "clipPath");
        if (definitions > SvgLimits.MaxDefinitions) violations.Add($"gradients/clipPaths {definitions} > {SvgLimits.MaxDefinitions}");
        var stops = all.Where(e => Gradients.Contains(e.Name)).Select(e => e.Elements.Count()).DefaultIfEmpty(0).Max();
        if (stops > SvgLimits.MaxStopsPerGradient) violations.Add($"stops {stops} > {SvgLimits.MaxStopsPerGradient}");
        var chars = all.Where(e => e.Name == "text").Sum(Chars);
        if (chars > SvgLimits.MaxTextCharacters) violations.Add($"text {chars} > {SvgLimits.MaxTextCharacters}");
        var bytes = Encoding.UTF8.GetByteCount(svg);
        if (bytes > SvgLimits.MaxOutputBytes) violations.Add($"output {bytes / 1024} kB > {SvgLimits.MaxOutputBytes / 1024} kB");
        if (violations.Count == 0) return;
        foreach (var v in violations.SkipLast(1)) _report.Add(SvgReportCodes.RejectedLimit, v);
        throw new SvgRejectedException(SvgReportCodes.RejectedLimit, violations[^1]);

        // Root svg = 1; the wrapper's children sit on level 2 when it is omitted.
        static int Depth(SvgElement e) => 1 + e.Elements.Select(Depth).DefaultIfEmpty(0).Max();
    }
}

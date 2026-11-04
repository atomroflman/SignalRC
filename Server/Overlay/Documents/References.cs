using System.Text.Json.Nodes;
using SignalRC.Server.Overlay.Expressions;

namespace SignalRC.Server.Overlay.Documents;

/// <summary>
/// A channel the document depends on. Location follows the diagnostics: a
/// formula's property/part/clip field, Field "source" (+ Ref) for a LiDAR
/// widget, Field "sources.telemetry" (+ Ref) for a staleness override.
/// </summary>
public sealed record SourceReference(SourceKind Kind, string Name, DiagnosticLocation Location);

public static partial class DocumentResolver
{
    /// <summary>
    /// All source references of a document: formula references (tel/out/sig, in
    /// document order and source order, duplicates kept), then LiDAR widget
    /// sources, then sources.telemetry keys. Disabled parts count too. Formulas
    /// that do not parse contribute nothing; a schema-invalid document has none.
    /// </summary>
    public static IReadOnlyList<SourceReference> SourceReferences(JsonObject doc)
    {
        if (CheckSchema(doc).Count > 0) return [];
        var list = new List<SourceReference>();
        // Dependencies do not depend on the environment; nothing is known here, so nothing is checked.
        var env = new ExpressionEnvironment(null, null, []);
        foreach (var formula in CollectFormulas(doc))
        {
            foreach (var dependency in Analyzer.Analyze(formula.Expr, env).Dependencies)
            {
                if (dependency.Kind != SourceKind.Driver) list.Add(new SourceReference(dependency.Kind, dependency.Name, formula.Location));
            }
        }
        foreach (var (element, location) in AllElements(doc))
        {
            if (element.Str("type") == "lidarWidget" && element.Str("source") is { } source)
            {
                list.Add(new SourceReference(SourceKind.Tel, source, location with { Field = "source", Ref = source }));
            }
        }
        foreach (var (name, _) in Json.Sorted(doc.Obj("sources").Obj("telemetry")))
        {
            list.Add(new SourceReference(SourceKind.Tel, name, new DiagnosticLocation { Field = "sources.telemetry", Ref = name }));
        }
        return list;
    }
}

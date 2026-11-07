using System.Text.Json.Serialization;
using SignalRC.Server.Overlay.Documents;

namespace SignalRC.Server.Overlay.Expressions;

// Static analysis (Shared/Overlay/expression/README.md §3, §5, §7). Port of the
// client's analyze.ts: client and server must report identical types,
// dependencies, diagnostic codes and offsets (§8).

[JsonConverter(typeof(JsonStringEnumConverter<ExprType>))]
public enum ExprType
{
    [JsonStringEnumMemberName("number")] Number,
    [JsonStringEnumMemberName("bool")] Bool,
    [JsonStringEnumMemberName("text")] Text,
    [JsonStringEnumMemberName("unknown")] Unknown,
}

[JsonConverter(typeof(JsonStringEnumConverter<SourceKind>))]
public enum SourceKind
{
    [JsonStringEnumMemberName("tel")] Tel,
    [JsonStringEnumMemberName("out")] Out,
    [JsonStringEnumMemberName("sig")] Sig,
    [JsonStringEnumMemberName("driver")] Driver,
}

/// <summary>A source reference; Name is empty for driver.</summary>
public sealed record Dependency(SourceKind Kind, string Name);

/// <param name="Dependencies">All references in source order, including duplicates and untaken branches.</param>
/// <param name="Diagnostics">At most one entry.</param>
public sealed record Analysis(ExprType Type, IReadOnlyList<Dependency> Dependencies, IReadOnlyList<ExpressionDiagnostic> Diagnostics);

public static class Analyzer
{
    public const int MaxLength = 1000;
    public const int MaxDepth = 32;

    /// <summary>Fixed signatures: argument types and result type.</summary>
    private static readonly Dictionary<string, (ExprType[] Args, ExprType Result)> Fixed = new()
    {
        ["abs"] = ([ExprType.Number], ExprType.Number),
        ["sign"] = ([ExprType.Number], ExprType.Number),
        ["clamp"] = ([ExprType.Number, ExprType.Number, ExprType.Number], ExprType.Number),
        ["map"] = ([ExprType.Number, ExprType.Number, ExprType.Number, ExprType.Number, ExprType.Number], ExprType.Number),
        ["mapClamped"] = ([ExprType.Number, ExprType.Number, ExprType.Number, ExprType.Number, ExprType.Number], ExprType.Number),
        ["round"] = ([ExprType.Number], ExprType.Number),
        ["floor"] = ([ExprType.Number], ExprType.Number),
        ["ceil"] = ([ExprType.Number], ExprType.Number),
        ["mod"] = ([ExprType.Number, ExprType.Number], ExprType.Number),
        ["wrap"] = ([ExprType.Number, ExprType.Number, ExprType.Number], ExprType.Number),
        ["sqrt"] = ([ExprType.Number], ExprType.Number),
        ["pow"] = ([ExprType.Number, ExprType.Number], ExprType.Number),
        ["hypot"] = ([ExprType.Number, ExprType.Number], ExprType.Number),
        ["sin"] = ([ExprType.Number], ExprType.Number),
        ["cos"] = ([ExprType.Number], ExprType.Number),
        ["tan"] = ([ExprType.Number], ExprType.Number),
        ["asin"] = ([ExprType.Number], ExprType.Number),
        ["acos"] = ([ExprType.Number], ExprType.Number),
        ["atan"] = ([ExprType.Number], ExprType.Number),
        ["atan2"] = ([ExprType.Number, ExprType.Number], ExprType.Number),
        ["rad"] = ([ExprType.Number], ExprType.Number),
        ["deg"] = ([ExprType.Number], ExprType.Number),
        ["pi"] = ([], ExprType.Number),
        ["driverActive"] = ([], ExprType.Bool),
    };

    private static readonly Dictionary<string, (ExprType Arg, ExprType Result)> Variadic = new()
    {
        ["min"] = (ExprType.Number, ExprType.Number),
        ["max"] = (ExprType.Number, ExprType.Number),
        ["concat"] = (ExprType.Text, ExprType.Text),
    };

    private static readonly string[] Special = ["tel", "out", "sig", "if", "valid", "fallback", "format", "formatDate", "formatDateUtc", "formatDuration"];

    /// <summary>Longest date/duration format literal (§6a).</summary>
    public const int MaxDateFormatLength = 64;

    public static readonly IReadOnlySet<string> Functions = new HashSet<string>(Fixed.Keys.Concat(Variadic.Keys).Concat(Special));

    /// <summary>Result type a property kind requires (§3); null = any type.</summary>
    public static ExprType? RequiredType(string expected) => expected switch
    {
        "number" or "length" or "angle" or "factor" or "opacity" or "integer" => ExprType.Number,
        "bool" => ExprType.Bool,
        "text" or "color" => ExprType.Text,
        _ => null,
    };

    public static string Name(ExprType type) => type switch
    {
        ExprType.Number => "number",
        ExprType.Bool => "bool",
        ExprType.Text => "text",
        _ => "unknown",
    };

    private static ExprType TelemetryType(TelemetryDataType t) => t switch
    {
        TelemetryDataType.Integer or TelemetryDataType.Number => ExprType.Number,
        TelemetryDataType.Boolean => ExprType.Bool,
        TelemetryDataType.String => ExprType.Text,
        _ => ExprType.Unknown,
    };

    private sealed class Walker(ExpressionEnvironment env)
    {
        public readonly List<ExpressionDiagnostic> Diagnostics = [];
        public readonly List<Dependency> Dependencies = [];

        private void Error(string code, int offset, string message) =>
            Diagnostics.Add(new ExpressionDiagnostic(code, DiagnosticCategory.Publish, offset, message));

        /// <summary>Reports a type mismatch at `node` unless either side is unknown.</summary>
        private void Expect(Node node, ExprType actual, ExprType wanted)
        {
            if (actual != ExprType.Unknown && actual != wanted)
            {
                Error("OVL_EXPR_TYPE", node.Start, $"{Name(wanted)} erwartet, {Name(actual)} gefunden");
            }
        }

        public ExprType Visit(Node node) => node switch
        {
            NumberNode => ExprType.Number,
            TextNode => ExprType.Text,
            BoolNode => ExprType.Bool,
            UnaryNode u => Unary(u),
            BinaryNode b => Binary(b),
            CallNode c => Call(c),
            _ => throw new ArgumentOutOfRangeException(nameof(node)),
        };

        private ExprType Unary(UnaryNode node)
        {
            var t = Visit(node.Operand);
            var wanted = node.Op == "-" ? ExprType.Number : ExprType.Bool;
            Expect(node.Operand, t, wanted);
            return wanted;
        }

        private ExprType Binary(BinaryNode node)
        {
            var l = Visit(node.Left);
            var r = Visit(node.Right);
            switch (node.Op)
            {
                case "+" or "-" or "*" or "/":
                    Expect(node.Left, l, ExprType.Number);
                    Expect(node.Right, r, ExprType.Number);
                    return ExprType.Number;
                case "<" or "<=" or ">" or ">=":
                    Expect(node.Left, l, ExprType.Number);
                    Expect(node.Right, r, ExprType.Number);
                    return ExprType.Bool;
                case "&&" or "||":
                    Expect(node.Left, l, ExprType.Bool);
                    Expect(node.Right, r, ExprType.Bool);
                    return ExprType.Bool;
                default: // == !=
                    if (l != ExprType.Unknown) Expect(node.Right, r, l);
                    return ExprType.Bool;
            }
        }

        private bool Arity(CallNode node, int min, int? max = null)
        {
            var hi = max ?? min;
            if (node.Args.Count >= min && node.Args.Count <= hi) return true;
            Error("OVL_EXPR_ARITY", node.Start, $"{node.Name} erwartet {(min == hi ? $"{min}" : $"{min}–{hi}")} Argumente");
            return false;
        }

        private List<ExprType> VisitAll(IReadOnlyList<Node> args) => args.Select(Visit).ToList();

        private ExprType Call(CallNode node)
        {
            var (name, args) = (node.Name, node.Args);
            if (!Functions.Contains(name))
            {
                Error("OVL_EXPR_UNKNOWN_FUNCTION", node.Start, $"unbekannte Funktion {name}");
                VisitAll(args);
                return ExprType.Unknown;
            }
            if (name is "tel" or "out" or "sig") return Source(node);
            if (Fixed.TryGetValue(name, out var fixedSig))
            {
                var argTypes = VisitAll(args);
                if (name == "driverActive")
                {
                    if (Arity(node, 0)) Dependencies.Add(new Dependency(SourceKind.Driver, ""));
                }
                else if (Arity(node, fixedSig.Args.Length))
                {
                    for (var i = 0; i < args.Count; i++) Expect(args[i], argTypes[i], fixedSig.Args[i]);
                }
                return fixedSig.Result;
            }
            if (Variadic.TryGetValue(name, out var variadic))
            {
                var argTypes = VisitAll(args);
                if (Arity(node, 2, 16))
                {
                    for (var i = 0; i < args.Count; i++) Expect(args[i], argTypes[i], variadic.Arg);
                }
                return variadic.Result;
            }
            var types = VisitAll(args);
            switch (name)
            {
                case "if":
                    if (!Arity(node, 3)) return ExprType.Unknown;
                    Expect(args[0], types[0], ExprType.Bool);
                    if (types[1] != ExprType.Unknown) Expect(args[2], types[2], types[1]);
                    return types[1] != ExprType.Unknown ? types[1] : types[2];
                case "valid":
                    Arity(node, 1);
                    return ExprType.Bool;
                case "fallback":
                    if (!Arity(node, 2)) return ExprType.Unknown;
                    if (types[0] != ExprType.Unknown) Expect(args[1], types[1], types[0]);
                    return types[0] != ExprType.Unknown ? types[0] : types[1];
                case "format":
                {
                    if (!Arity(node, 2)) return ExprType.Text;
                    Expect(args[0], types[0], ExprType.Number);
                    var d = args[1];
                    if (d is not NumberNode digits)
                    {
                        Error("OVL_EXPR_LITERAL_REQUIRED", d.Start, "Dezimalstellen müssen eine feste Zahl sein");
                    }
                    else if (!double.IsInteger(digits.Value) || digits.Value < 0 || digits.Value > 6)
                    {
                        Error("OVL_EXPR_ARGUMENT_RANGE", d.Start, "Dezimalstellen 0–6 erwartet");
                    }
                    return ExprType.Text;
                }
                case "formatDate" or "formatDateUtc" or "formatDuration":
                {
                    if (!Arity(node, 2)) return ExprType.Text;
                    Expect(args[0], types[0], ExprType.Number);
                    var f = args[1];
                    if (f is not TextNode format)
                    {
                        Error("OVL_EXPR_LITERAL_REQUIRED", f.Start, "Format muss ein Textliteral sein");
                    }
                    else if (format.Value.Length == 0 || format.Value.Length > MaxDateFormatLength)
                    {
                        Error("OVL_EXPR_ARGUMENT_RANGE", f.Start, $"Format mit 1–{MaxDateFormatLength} Zeichen erwartet");
                    }
                    return ExprType.Text;
                }
            }
            return ExprType.Unknown;
        }

        private ExprType Source(CallNode node)
        {
            VisitAll(node.Args);
            if (!Arity(node, 1)) return ExprType.Unknown;
            if (node.Args[0] is not TextNode arg)
            {
                Error("OVL_EXPR_LITERAL_REQUIRED", node.Args[0].Start, "Quellname muss ein Textliteral sein");
                return ExprType.Unknown;
            }
            var kind = node.Name switch { "tel" => SourceKind.Tel, "out" => SourceKind.Out, _ => SourceKind.Sig };
            Dependencies.Add(new Dependency(kind, arg.Value));
            ExprType Unknown()
            {
                Error("OVL_REF_UNKNOWN_SOURCE", node.Start, $"unbekannte Quelle {node.Name}(\"{arg.Value}\")");
                return ExprType.Unknown;
            }
            ExprType LidarGrid()
            {
                Error("OVL_EXPR_TYPE", node.Start, "Ein LiDAR-Raster ist kein Formelwert");
                return ExprType.Unknown;
            }
            // Missing telemetry/outputs mean "not known here": no check. Outputs are numbers either way.
            return kind switch
            {
                SourceKind.Tel when env.Telemetry == null => ExprType.Unknown,
                SourceKind.Tel when env.Telemetry.TryGetValue(arg.Value, out var grid) && grid == TelemetryDataType.LidarGrid => LidarGrid(),
                SourceKind.Tel => env.Telemetry.TryGetValue(arg.Value, out var t) ? TelemetryType(t) : Unknown(),
                SourceKind.Out when env.Outputs == null => ExprType.Number,
                SourceKind.Out => env.Outputs.Contains(arg.Value) ? ExprType.Number : Unknown(),
                _ => env.Signals.Contains(arg.Value) ? ExprType.Number : Unknown(),
            };
        }
    }

    /// <summary>
    /// Analyzes a formula. At most one diagnostic is reported, chosen in this
    /// order: length, syntax, depth, the first semantic error in source order,
    /// finally a wrong result type (which sits at offset 0 and would otherwise
    /// hide every real error).
    /// </summary>
    /// <param name="expected">Property kind of §3 ("any" = no result type check).</param>
    public static Analysis Analyze(string source, ExpressionEnvironment env, string expected = "any")
    {
        static Analysis Empty(ExpressionDiagnostic d) => new(ExprType.Unknown, [], [d]);
        // Length counts code points like the JavaScript for…of loop (lone surrogates count once).
        if (Json.Length(source) > MaxLength)
        {
            return Empty(new ExpressionDiagnostic("OVL_LIMIT_EXCEEDED", DiagnosticCategory.Structure, 0, "Formel länger als 1000 Zeichen"));
        }
        if (Json.JsTrim(source) == "") return Empty(new ExpressionDiagnostic("OVL_EXPR_EMPTY", DiagnosticCategory.Publish, 0, "Formel ist leer"));
        Node ast;
        try
        {
            ast = Parser.Parse(source);
        }
        catch (ExpressionSyntaxException e)
        {
            return Empty(new ExpressionDiagnostic("OVL_EXPR_SYNTAX", DiagnosticCategory.Publish, e.Offset, e.Message));
        }
        if (Parser.Depth(ast) > MaxDepth)
        {
            return Empty(new ExpressionDiagnostic("OVL_LIMIT_EXCEEDED", DiagnosticCategory.Structure, 0, "Formel tiefer als 32 Ebenen"));
        }
        var walker = new Walker(env);
        var type = walker.Visit(ast);
        List<ExpressionDiagnostic> diagnostics = [];
        if (walker.Diagnostics.Count > 0)
        {
            // First in source order; on equal offsets the first reported.
            var first = walker.Diagnostics[0];
            foreach (var d in walker.Diagnostics)
            {
                if (d.Offset < first.Offset) first = d;
            }
            diagnostics.Add(first);
        }
        else if (RequiredType(expected) is { } required && type != ExprType.Unknown && type != required)
        {
            diagnostics.Add(new ExpressionDiagnostic("OVL_EXPR_RESULT_TYPE", DiagnosticCategory.Publish, 0,
                $"Ergebnis muss {Name(required)} sein, ist {Name(type)}"));
        }
        return new Analysis(type, walker.Dependencies, diagnostics);
    }
}

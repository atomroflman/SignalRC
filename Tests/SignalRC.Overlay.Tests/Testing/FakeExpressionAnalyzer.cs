using System.Text.RegularExpressions;
using SignalRC.Server.Overlay.Documents;

namespace SignalRC.Overlay.Tests.Testing;

// Test double for the expression port until AP06 exists: it only reports
// unknown sources, found by a plain pattern match.
public sealed partial class FakeExpressionAnalyzer : IExpressionAnalyzer
{
    public static readonly FakeExpressionAnalyzer Instance = new();

    // ECMAScript option: \b and \s behave like the client's JavaScript pattern.
    [GeneratedRegex("""\b(tel|out|sig)\(\s*"([^"\\]*)"\s*\)""", RegexOptions.ECMAScript)]
    private static partial Regex Source();

    public ExpressionAnalysis Analyze(string expr, ExpressionEnvironment env, string expected)
    {
        var diagnostics = new List<ExpressionDiagnostic>();
        foreach (Match match in Source().Matches(expr))
        {
            var kind = match.Groups[1].Value;
            var name = match.Groups[2].Value;
            var known = kind switch
            {
                "sig" => env.Signals.Contains(name),
                "out" => env.Outputs.Contains(name),
                _ => env.Telemetry.Count == 0 || env.Telemetry.ContainsKey(name),
            };
            if (!known && (kind != "out" || env.Outputs.Count > 0))
            {
                diagnostics.Add(new ExpressionDiagnostic("OVL_REF_UNKNOWN_SOURCE", DiagnosticCategory.Publish, match.Index));
            }
        }
        return new ExpressionAnalysis(diagnostics);
    }
}

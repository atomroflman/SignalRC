using SignalRC.Server.Overlay.Documents;

namespace SignalRC.Server.Overlay.Expressions;

/// <summary>The expression port of the document validation (AP01).</summary>
public sealed class ExpressionAnalyzer : IExpressionAnalyzer
{
    public static readonly ExpressionAnalyzer Instance = new();

    public ExpressionAnalysis Analyze(string expr, ExpressionEnvironment env, string expected) =>
        new(Analyzer.Analyze(expr, env, expected).Diagnostics);
}

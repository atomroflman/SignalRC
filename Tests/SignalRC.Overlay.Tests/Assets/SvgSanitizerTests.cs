using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.DependencyInjection;
using SignalRC.Overlay.Tests.Testing;
using SignalRC.Server.Overlay;
using SignalRC.Server.Overlay.Assets;

namespace SignalRC.Overlay.Tests.Assets;

/// <summary>AP07: sanitizer against the shared SVG fixtures and generated limit cases.</summary>
public class SvgSanitizerTests
{
    private const string Prologue = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ";
    private static readonly SvgAssetSanitizer Sanitizer = new();

    public static TheoryData<string> CaseIds()
    {
        var data = new TheoryData<string>();
        foreach (var c in Cases()) data.Add(c!["id"]!.GetValue<string>());
        return data;
    }

    private static JsonArray Cases() => Contracts.ReadJson("fixtures/svg/cases.json")!["cases"]!.AsArray();

    private static SvgSanitizeResult Run(string svg) => Sanitizer.Sanitize(Encoding.UTF8.GetBytes(svg));

    private static SvgSanitizeResult RunFixture(string file) =>
        Sanitizer.Sanitize(File.ReadAllBytes(Path.Combine(Contracts.Root, "fixtures", "svg", "input", file)));

    private static int Count(SvgSanitizeResult result, string code) =>
        result.Report.Where(e => e!["code"]!.GetValue<string>() == code).Select(e => e!["count"]!.GetValue<int>()).SingleOrDefault();

    private static string? Rejection(SvgSanitizeResult result) =>
        result.Report.Select(e => e!["code"]!.GetValue<string>()).LastOrDefault(c => c.StartsWith("SVG_REJECTED_"));

    [Theory]
    [MemberData(nameof(CaseIds))]
    public void FixtureCase(string id)
    {
        var c = Cases().Single(x => x!["id"]!.GetValue<string>() == id)!;
        var result = RunFixture(c["input"]!.GetValue<string>());
        Assert.Equal(c["accepted"]!.GetValue<bool>(), result.Accepted);
        if (c["report"] is JsonObject report)
        {
            foreach (var (code, min) in report)
            {
                Assert.True(Count(result, code) >= min!.GetValue<int>(), $"{code}: {Count(result, code)} < {min} in {result.Report.ToJsonString()}");
            }
        }
        if (!result.Accepted)
        {
            Assert.Equal(c["rejected"]!.GetValue<string>(), Rejection(result));
            Assert.Null(result.Svg);
            Assert.Null(result.AssetId);
            return;
        }
        Assert.Null(Rejection(result));
        var svg = result.Svg!;
        if (c["expected"] is JsonValue expected)
        {
            var path = Path.Combine(Contracts.Root, "fixtures", "svg", "expected", expected.GetValue<string>());
            if (Environment.GetEnvironmentVariable("SVG_UPDATE_EXPECTED") == "1") File.WriteAllText(path, svg + "\n");
            Assert.Equal(File.ReadAllText(path).TrimEnd('\n'), svg);
        }
        if (c["width"] is JsonValue w) Assert.Equal(w.GetValue<double>(), result.Metadata!["width"]!.GetValue<double>());
        if (c["height"] is JsonValue h) Assert.Equal(h.GetValue<double>(), result.Metadata!["height"]!.GetValue<double>());
        if (c["parts"] is JsonObject parts)
        {
            Assert.Equal(parts.Select(p => p.Key), result.Metadata!["parts"]!.AsObject().Select(p => p.Key));
            Assert.True(Contracts.IsSubset(parts, result.Metadata["parts"]), result.Metadata["parts"]!.ToJsonString());
        }
        var body = svg.Replace("xmlns=\"http://www.w3.org/2000/svg\"", "");
        foreach (var forbidden in c["forbidden"]?.AsArray() ?? [])
        {
            Assert.DoesNotContain(forbidden!.GetValue<string>(), body, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Theory]
    [MemberData(nameof(CaseIds))]
    public void AcceptedOutputIsSafeStableAndIdempotent(string id)
    {
        var c = Cases().Single(x => x!["id"]!.GetValue<string>() == id)!;
        var first = RunFixture(c["input"]!.GetValue<string>());
        if (!first.Accepted) return;
        Assert.Null(SvgSafetyCheck.Verify(first.Svg!));
        Assert.StartsWith(Prologue, first.Svg);
        Assert.Matches("^sha256-[0-9a-f]{64}$", first.AssetId!);
        Assert.Equal(first.AssetId, first.Metadata!["assetId"]!.GetValue<string>());

        // Deterministic: the same file gives the same asset.
        var again = RunFixture(c["input"]!.GetValue<string>());
        Assert.Equal(first.Svg, again.Svg);
        Assert.Equal(first.Metadata.ToJsonString(), again.Metadata!.ToJsonString());

        // Idempotent: re-importing the normalized asset (exchange package) keeps id and parts.
        var reimport = Run(first.Svg!);
        Assert.True(reimport.Accepted, reimport.Report.ToJsonString());
        Assert.Equal(first.Svg, reimport.Svg);
        Assert.Equal(first.Metadata.ToJsonString(), reimport.Metadata!.ToJsonString());
        Assert.Empty(reimport.Report);
    }

    // --- Allowed content ---

    [Fact]
    public void KeepsAllowedGeometryAndNormalizesValues()
    {
        var result = Run("""
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
              <path id="p" d="m10,10 l5-5 h5 v5 c1 1 2 2 3 3 s1 1 2 2 a5 5 0 0 1 5 5 z" fill="RED" stroke="#ABC" stroke-width="1in"/>
            </svg>
            """);
        Assert.True(result.Accepted);
        Assert.Contains("d=\"M10 10L15 5L20 5L20 10C21 11 22 12 23 13C24 14 24 14 25 15A5 5 0 0 1 30 20Z\"", result.Svg);
        Assert.Contains("fill=\"#ff0000\" stroke=\"#aabbcc\" stroke-width=\"96\"", result.Svg);
    }

    [Theory]
    [InlineData("#abcd", "#aabbccdd")]
    [InlineData("#AABBCCFF", "#aabbcc")]
    [InlineData("rgba(0,0,255,.5)", "#0000ff80")]
    [InlineData("rgb(100% 0% 0% / 25%)", "#ff000040")]
    [InlineData("transparent", "#00000000")]
    [InlineData("RebeccaPurple", "#663399")]
    [InlineData("currentColor", "#123456")]
    [InlineData("none", "none")]
    public void NormalizesColors(string input, string expected)
    {
        var result = Run($"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" color="#123456"><rect width="1" height="1" fill="{input}"/></svg>""");
        Assert.Contains($"fill=\"{expected}\"", result.Svg);
    }

    [Theory]
    [InlineData("Roboto Mono", "monospace")]
    [InlineData("Consolas, monospace", "monospace")]
    [InlineData("Arial Narrow", "condensed")]
    [InlineData("'Roboto Condensed'", "condensed")]
    [InlineData("Times New Roman", "serif")]
    [InlineData("PT Serif", "serif")]
    [InlineData("Noto Sans", "sans-serif")]
    [InlineData("sans-serif", "sans-serif")]
    [InlineData("Helvetica", "sans-serif")]
    public void MapsFontsToGenericFamilies(string font, string expected)
    {
        var result = Run($"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text font-family="{font}">A</text></svg>""");
        Assert.Contains($"font-family=\"{expected}\"", result.Svg);
        Assert.Equal(font == expected ? 0 : 1, Count(result, SvgReportCodes.FontMapped));
    }

    [Fact]
    public void ReusedAssetGetsDistinctIdsOnlyThroughTheRendererPrefix()
    {
        // Internal ids are short and canonical (r<n>); the renderer prefixes them per element (§5).
        var result = RunFixture("gradients-use.svg");
        var ids = Regex.Matches(result.Svg!, "id=\"([^\"]+)\"").Select(m => m.Groups[1].Value).ToList();
        Assert.Equal(["r1", "r2", "r3", "r4"], ids);
        Assert.All(Regex.Matches(result.Svg!, "url\\(#([^)]+)\\)").Select(m => m.Groups[1].Value), id => Assert.Contains(id, ids));
    }

    [Fact]
    public void PartIdsAreSanitizedTruncatedAndUnique()
    {
        var longId = new string('x', 80);
        var result = Run($"""
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
              <rect id="{longId}" width="1" height="1"/><rect id="{longId}" width="1" height="1"/>
              <g><rect id="ä.ö" width="1" height="1"/></g>
              <rect id="" width="1" height="1"/>
            </svg>
            """);
        var parts = result.Metadata!["parts"]!.AsObject().Select(p => p.Key).ToList();
        Assert.Equal([new string('x', 64), new string('x', 62) + "-2", "part-1", "___", "part-2"], parts);
        Assert.All(parts, p => Assert.Matches("^[A-Za-z0-9_-]{1,64}$", p));
    }

    [Fact]
    public void UseCloneIsNotAPartButItsUseIs()
    {
        var result = Run("""
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
              <g id="shape"><rect id="inner" width="1" height="1"/></g>
              <use id="copy" href="#shape" x="5"/>
            </svg>
            """);
        Assert.Equal(["shape", "inner", "copy"], result.Metadata!["parts"]!.AsObject().Select(p => p.Key));
        Assert.Equal(2, Regex.Matches(result.Svg!, "<rect").Count);
    }

    [Fact]
    public void UseInsideClipPathBecomesTransformedShape()
    {
        var result = Run("""
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
              <defs><rect id="box" width="4" height="4"/><clipPath id="c"><use href="#box" x="2" y="3"/></clipPath></defs>
              <rect width="10" height="10" clip-path="url(#c)"/>
            </svg>
            """);
        Assert.Contains("<clipPath id=\"r1\"><rect width=\"4\" height=\"4\" transform=\"translate(2 3)\"/></clipPath>", result.Svg);
    }

    [Fact]
    public void GradientInheritanceCycleIsBrokenAndReported()
    {
        var result = Run("""
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
              <linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"><stop offset="0" stop-color="red"/></linearGradient>
              <rect width="10" height="10" fill="url(#a)"/>
            </svg>
            """);
        Assert.True(result.Accepted);
        Assert.True(Count(result, SvgReportCodes.RemovedAttribute) >= 1);
        Assert.DoesNotContain("href", result.Svg);
    }

    [Fact]
    public void AcceptsUtf16WithBomAndIgnoresDeclaredEncoding()
    {
        const string svg = """<?xml version="1.0" encoding="ISO-8859-1"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>Grüße</text></svg>""";
        var utf16 = Sanitizer.Sanitize([.. Encoding.Unicode.GetPreamble(), .. Encoding.Unicode.GetBytes(svg.Replace("ISO-8859-1", "UTF-16"))]);
        var utf8 = Sanitizer.Sanitize([.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(svg)]);
        Assert.True(utf16.Accepted);
        Assert.Contains("Grüße", utf16.Svg);
        Assert.Equal(utf16.Svg, utf8.Svg);
    }

    // --- Rejections and limits ---

    [Fact]
    public void RejectsInvalidUtf8AndEmptyInput()
    {
        Assert.Equal(SvgReportCodes.RejectedParse, Rejection(Sanitizer.Sanitize([0x3C, 0x73, 0x76, 0x67, 0xFF, 0xFE, 0x3E])));
        Assert.Equal(SvgReportCodes.RejectedParse, Rejection(Sanitizer.Sanitize([])));
        Assert.Equal(SvgReportCodes.RejectedParse, Rejection(Run("not xml")));
    }

    [Fact]
    public void RejectsDoctypeEvenWithoutEntities()
    {
        Assert.Equal(SvgReportCodes.RejectedDoctype, Rejection(Run("""<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>""")));
    }

    [Fact]
    public void RejectsUndeclaredEntities()
    {
        Assert.Equal(SvgReportCodes.RejectedParse, Rejection(Run("""<svg xmlns="http://www.w3.org/2000/svg"><text>&nbsp;</text></svg>""")));
    }

    [Fact]
    public void RejectsRawFileOverLimit()
    {
        var padding = new string(' ', SvgLimits.MaxRawBytes);
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Run($"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/>{padding}</svg>""")));
    }

    [Fact]
    public void RejectsTooManyElements()
    {
        Assert.True(Run(Svg(Repeat("<rect width=\"1\" height=\"1\"/>", SvgLimits.MaxElements - 1))).Accepted);
        var result = Run(Svg(Repeat("<rect width=\"1\" height=\"1\"/>", SvgLimits.MaxElements)));
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(result));
        Assert.Contains("elements", result.Report.ToJsonString());
    }

    [Fact]
    public void RejectsDeepNesting()
    {
        // Root svg = level 1, so 31 groups plus a shape just fit.
        Assert.True(Run(Svg(Repeat("<g>", 30) + "<rect width=\"1\" height=\"1\"/>" + Repeat("</g>", 30))).Accepted);
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Run(Svg(Repeat("<g>", 31) + "<rect width=\"1\" height=\"1\"/>" + Repeat("</g>", 31)))));
        // Raw nesting is bounded before any processing.
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Run(Svg(Repeat("<g>", 5000) + Repeat("</g>", 5000)))));
    }

    [Fact]
    public void RejectsTooManyCoordinates()
    {
        Assert.True(Run(Svg("<path d=\"M0 0" + Repeat("L1 1", SvgLimits.MaxCoordinates - 1) + "\"/>")).Accepted);
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Run(Svg("<path d=\"M0 0" + Repeat("L1 1", SvgLimits.MaxCoordinates) + "\"/>"))));
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Run(Svg("<polygon points=\"" + Repeat("1 1 ", SvgLimits.MaxCoordinates + 1) + "\"/>"))));
    }

    [Fact]
    public void RejectsTooManyDefinitionsAndStops()
    {
        var gradients = Enumerable.Range(0, SvgLimits.MaxDefinitions + 1)
            .Select(i => $"<linearGradient id=\"g{i}\"><stop offset=\"0\"/></linearGradient><rect width=\"1\" height=\"1\" fill=\"url(#g{i})\"/>");
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Run(Svg(string.Concat(gradients)))));
        var stops = Repeat("<stop offset=\"0\"/>", SvgLimits.MaxStopsPerGradient + 1);
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Run(Svg($"<linearGradient id=\"g\">{stops}</linearGradient><rect width=\"1\" height=\"1\" fill=\"url(#g)\"/>"))));
    }

    [Fact]
    public void RejectsTooMuchText()
    {
        Assert.True(Run(Svg($"<text>{new string('a', SvgLimits.MaxTextCharacters)}</text>")).Accepted);
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Run(Svg($"<text>{new string('a', SvgLimits.MaxTextCharacters + 1)}</text>"))));
    }

    [Fact]
    public void RejectsOutputOverLimit()
    {
        // Short input numbers expand: 1e5 → 100000.
        var input = Svg("<polygon points=\"" + Repeat("1e5,1e5 ", 30_000) + "\"/>");
        Assert.True(Encoding.UTF8.GetByteCount(input) <= SvgLimits.MaxRawBytes);
        var result = Run(input);
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(result));
        Assert.Contains("output", result.Report.ToJsonString());
    }

    [Fact]
    public void RejectsHugeSize()
    {
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Run("""<svg xmlns="http://www.w3.org/2000/svg" width="1000000" viewBox="0 0 1 1000000"><rect width="1" height="1"/></svg>""")));
    }

    // --- Robustness (found in review: crash, memory and CPU amplification) ---

    private static SvgSanitizeResult Timed(string svg)
    {
        Assert.True(Encoding.UTF8.GetByteCount(svg) <= SvgLimits.MaxRawBytes, "input over limit");
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var result = Run(svg);
        Assert.True(watch.ElapsedMilliseconds < 2000, $"took {watch.ElapsedMilliseconds} ms");
        return result;
    }

    [Fact]
    public void LongGradientChainIsRejectedWithoutRecursion()
    {
        var chain = string.Concat(Enumerable.Range(0, 6000).Select(i => $"<linearGradient id='g{i}' href='#g{i + 1}'/>"));
        var result = Timed(Svg(chain + "<linearGradient id='g6000'><stop/></linearGradient><rect width='1' height='1' fill='url(#g0)'/>"));
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(result));
    }

    [Fact]
    public void GradientStopFanOutIsBounded()
    {
        var input = Svg("<linearGradient id='t'>" + Repeat("<stop/>", 5000) + "</linearGradient>"
            + string.Concat(Enumerable.Range(0, 1000).Select(i => $"<linearGradient id='g{i}' href='#t'/>")) + "<rect width='1' height='1' fill='url(#g1)'/>");
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Timed(input)));
        // Fan-out within the stop limit is still bounded by the element budget.
        var many = Svg("<linearGradient id='t'>" + Repeat("<stop/>", 32) + "</linearGradient>"
            + string.Concat(Enumerable.Range(0, 3000).Select(i => $"<linearGradient id='g{i}' href='#t'/>")) + "<rect width='1' height='1' fill='url(#g1)'/>");
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Timed(many)));
    }

    [Theory]
    [InlineData("@a{}", 60000)]
    [InlineData("@a;", 60000)]
    [InlineData("@media x{", 20000)]
    public void ManyAtRulesAreLinear(string rule, int count)
    {
        Assert.False(Rejection(Timed(Svg($"<style>{Repeat(rule, count)}</style><rect width='1' height='1'/>"))) is SvgReportCodes.RejectedParse);
    }

    [Fact]
    public void ManyCssRulesAreBounded()
    {
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Timed(Svg("<style>" + Repeat("x,", 60000) + "x{fill:red}</style>" + Repeat("<g/>", 1000) + "<rect width='1' height='1'/>"))));
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Timed(Svg("<style>rect{" + Repeat("fill:red;", 20000) + "}</style>" + Repeat("<rect width='1' height='1'/>", 1000)))));
        // Within the bounds, class rules over many elements stay cheap.
        var rules = string.Concat(Enumerable.Range(0, 1000).Select(i => $".c{i}{{fill:#{i % 10}{i % 10}{i % 10}}}"));
        var shapes = string.Concat(Enumerable.Range(0, 1999).Select(i => $"<rect class='c{i % 1000}' width='1' height='1'/>"));
        Assert.True(Timed(Svg($"<style>{rules}</style>{shapes}")).Accepted);
    }

    [Fact]
    public void ManyAttributesAreRejected()
    {
        var attributes = string.Concat(Enumerable.Range(0, 20000).Select(i => $" a{i}='1'"));
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Timed(Svg($"<rect width='1' height='1'{attributes}/>"))));
    }

    [Fact]
    public void ManyTextChunksAreJoinedLinearly()
    {
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Timed(Svg("<text>" + Repeat("a<![CDATA[b]]>", 15000) + "</text>"))));
    }

    [Theory]
    [InlineData("<svg xmlns='http://www.w3.org/2000/svg' viewBox='-1000000 0 1 1' width='1000000' height='1000000'><rect x='-1000000' width='1' height='1'/></svg>")]
    [InlineData("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 0.001 0.001' width='1000' height='1000' transform='scale(1000000)'><rect width='1' height='1'/></svg>")]
    [InlineData("<svg xmlns='http://www.w3.org/2000/svg'><rect x='-1000000' width='1000000' height='1'/><rect x='999999' width='1' height='1'/></svg>")]
    public void OutOfRangeTransformsAreRejectedAsLimit(string svg)
    {
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Run(svg)));
    }

    [Theory]
    [InlineData("M0 0C1e12 1e12 1 1 2 2")]
    [InlineData("M0 0C0 0 999999 999999 -999999 -999999S1 1 2 2")]
    public void OutOfRangeControlPointsTruncateThePath(string d)
    {
        var result = Run(Svg($"<path d='{d}' stroke='black'/><rect width='1' height='1'/>"));
        Assert.True(result.Accepted);
        Assert.DoesNotContain("1000000000000", result.Svg);
        Assert.DoesNotContain("-2999997", result.Svg);
        Assert.Null(SvgSafetyCheck.Verify(result.Svg!));
    }

    [Theory]
    [InlineData("<path d='M10 10 a1e-7 1e-7 0 1 1 5 5' stroke='black'/>")]
    [InlineData("<text x='1' y='5'> <tspan> b</tspan></text>")]
    [InlineData("<text><tspan>a </tspan> </text>")]
    [InlineData("<text>a<tspan> </tspan> b</text>")]
    public void EdgeCasesAreIdempotent(string body)
    {
        var first = Run(Svg(body));
        Assert.True(first.Accepted);
        var second = Run(first.Svg!);
        Assert.Equal(first.Svg, second.Svg);
        Assert.Equal(first.Metadata!.ToJsonString(), second.Metadata!.ToJsonString());
    }

    [Fact]
    public void DuplicateIdsResolveToTheFirstInDocumentOrder()
    {
        var result = Run(Svg("<linearGradient id='g'><stop stop-color='red'/></linearGradient><symbol><linearGradient id='g'><stop stop-color='blue'/></linearGradient></symbol><rect width='1' height='1' fill='url(#g)'/>"));
        Assert.Contains("#ff0000", result.Svg);
        Assert.DoesNotContain("#0000ff", result.Svg);
    }

    [Fact]
    public void UseInsideClipPathInNestedDefsIsExpanded()
    {
        var result = Run(Svg("<defs><rect id='b' width='4' height='4'/><g><clipPath id='c'><use href='#b'/></clipPath></g></defs><rect width='10' height='10' clip-path='url(#c)'/>"));
        Assert.Contains("<clipPath id=\"r1\"><rect width=\"4\" height=\"4\"/></clipPath>", result.Svg);
    }

    [Fact]
    public void HiddenRootIsEmpty()
    {
        Assert.Equal(SvgReportCodes.RejectedEmpty, Rejection(Run("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' style='display:none'><rect width='1' height='1'/></svg>")));
    }

    [Fact]
    public void NonFiniteHueIsInvalid()
    {
        var result = Run(Svg("<rect width='1' height='1' fill='hsl(NaN, 50%, 50%)'/><rect width='1' height='1' fill='hsl(Infinity, 50%, 50%)'/>"));
        Assert.DoesNotContain("fill=", result.Svg);
    }

    [Fact]
    public void TextPositionListsCountAsCoordinates()
    {
        var x = string.Join(' ', Enumerable.Repeat("1", 2 * SvgLimits.MaxCoordinates + 2));
        Assert.Equal(SvgReportCodes.RejectedLimit, Rejection(Run(Svg($"<text x='{x}'>a</text>"))));
    }

    [Fact]
    public void RejectsNonSvgRootAndSvgInForeignNamespace()
    {
        Assert.Equal(SvgReportCodes.RejectedParse, Rejection(Run("""<svg xmlns="http://example.com/not-svg"><rect width="1" height="1"/></svg>""")));
        Assert.Equal(SvgReportCodes.RejectedParse, Rejection(Run("""<x:svg xmlns:x="http://www.w3.org/1999/xhtml"/>""")));
    }

    [Fact]
    public void ReportKeepsAtMostThreeShortExamples()
    {
        var result = Run(Svg("<rect width=\"1\" height=\"1\"/>" + string.Concat(Enumerable.Range(0, 10).Select(i => $"<script>{i}</script><foo{i}/>"))));
        var entry = result.Report.Single(e => e!["code"]!.GetValue<string>() == SvgReportCodes.RemovedElement)!;
        Assert.Equal(20, entry["count"]!.GetValue<int>());
        Assert.Equal(["script", "foo0", "foo1"], entry["examples"]!.AsArray().Select(e => e!.GetValue<string>()));
        var longName = Run(Svg($"<rect width=\"1\" height=\"1\" fill=\"url(https://{new string('e', 200)})\"/>"));
        Assert.All(longName.Report.SelectMany(e => e!["examples"]!.AsArray()), e => Assert.True(e!.GetValue<string>().Length <= 60));
    }

    // --- Independent safety check ---

    [Theory]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><script>alert(1)</script></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><rect width=\"1\" height=\"1\" onclick=\"x()\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><rect width=\"1\" height=\"1\" fill=\"url(http://e/x)\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><rect width=\"1\" height=\"1\" fill=\"url(#r9)\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><rect width=\"1\" height=\"1\" style=\"fill:red\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><rect width=\"1e3\" height=\"1\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><use href=\"#a\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\" width=\"1\"><rect width=\"1\" height=\"1\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:x=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 1 1\"><rect x:href=\"#a\" width=\"1\" height=\"1\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><!-- c --><rect width=\"1\" height=\"1\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><text><![CDATA[x]]></text></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><g>text</g></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><rect data-part=\"a\" width=\"1\" height=\"1\"/><rect data-part=\"a\" width=\"1\" height=\"1\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><linearGradient id=\"r1\"/><rect width=\"1\" height=\"1\" clip-path=\"url(#r1)\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><path d=\"M0 0 l1 1\"/></svg>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><text font-family=\"Arial\">a</text></svg>")]
    [InlineData("<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"/>")]
    public void SafetyCheckRejectsNonCanonicalOutput(string svg)
    {
        Assert.NotNull(SvgSafetyCheck.Verify(svg));
    }

    [Fact]
    public void SafetyCheckAcceptsCanonicalOutput()
    {
        Assert.Null(SvgSafetyCheck.Verify("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"><defs><linearGradient id=\"r1\"><stop offset=\"0.5\" stop-color=\"#ff0000\"/></linearGradient></defs><rect data-part=\"a\" width=\"1\" height=\"1\" fill=\"url(#r1)\"/><text x=\"0 1\">a<tspan> b</tspan></text></svg>"));
    }

    // --- Port ---

    [Fact]
    public void IsRegisteredAsTheUploadSanitizer()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddOverlay();
        var sanitizer = services.BuildServiceProvider().GetRequiredService<ISvgAssetSanitizer>();
        Assert.IsType<SvgAssetSanitizer>(sanitizer);
        Assert.True(sanitizer.IsAvailable);
    }

    private static string Svg(string body) => $"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\">{body}</svg>";

    private static string Repeat(string s, int n) => string.Concat(Enumerable.Repeat(s, n));
}

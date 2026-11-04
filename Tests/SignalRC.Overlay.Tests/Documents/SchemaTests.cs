using System.Text.Json.Nodes;
using Json.Schema;
using SignalRC.Overlay.Tests.Testing;
using SignalRC.Server.Overlay.Documents;
using Xunit.Abstractions;

namespace SignalRC.Overlay.Tests.Documents;

public class SchemaTests(ITestOutputHelper output)
{
    private static readonly JsonSchema Schema = JsonSchema.FromText(Contracts.ReadText("schema/overlay-document.schema.json"));
    private static readonly EvaluationOptions Options = new() { OutputFormat = OutputFormat.Flag };

    private static bool SchemaValid(JsonNode? doc) => Schema.Evaluate(doc, Options).IsValid;

    public static TheoryData<string, bool> Cases()
    {
        var data = new TheoryData<string, bool>();
        foreach (var c in Contracts.ReadJson("fixtures/documents/cases.json")!["cases"]!.AsArray())
        {
            data.Add(c!["file"]!.GetValue<string>(), c["schemaValid"]!.GetValue<bool>());
        }
        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void AgreesWithExpectation(string file, bool schemaValid)
    {
        var doc = Contracts.ReadJson($"fixtures/documents/{file}");
        Assert.Equal(schemaValid, SchemaValid(doc));
        Assert.Equal(schemaValid, DocumentResolver.CheckSchema(doc).Count == 0);
    }

    [Fact]
    public void ReportsAnUnsupportedSchemaVersionOnItsOwn()
    {
        var d = DocumentResolver.CheckSchema(JsonNode.Parse("""{ "schemaVersion": 2, "workspace": {}, "elements": {}, "children": [] }"""));
        Assert.Equal(["OVL_SCHEMA_UNSUPPORTED"], d.Select(x => x.Code));
    }

    private sealed record Mutation(object[] Path, string? Replacement);

    private static readonly string[] Replacements =
    [
        "null", "0", "-1", "1.5", "\"\"", "\"x\"", "\"root\"", "true", "[]", "{}", "\"#ff0000\"",
        $"\"{new string('a', 1001)}\"", "17000", "0.0",
    ];

    /// <summary>Deterministic mutations of valid documents to compare both validators on many shapes; null replacement deletes.</summary>
    private static IEnumerable<Mutation> Mutations(JsonNode? value, object[] path)
    {
        foreach (var r in Replacements) yield return new Mutation(path, r);
        if (value is JsonArray array)
        {
            for (var i = 0; i < array.Count; i++)
            {
                foreach (var m in Mutations(array[i], [.. path, i])) yield return m;
            }
        }
        else if (value is JsonObject obj)
        {
            foreach (var (k, v) in obj)
            {
                yield return new Mutation([.. path, k], null);
                foreach (var m in Mutations(v, [.. path, k])) yield return m;
            }
            yield return new Mutation([.. path, "unexpectedKey"], "1");
        }
    }

    private static JsonNode? Apply(JsonNode? doc, Mutation m)
    {
        if (m.Path.Length == 0) return JsonNode.Parse(m.Replacement!);
        var copy = doc!.DeepClone();
        var target = copy;
        foreach (var key in m.Path[..^1]) target = key is int i ? target![i] : target![(string)key];
        var last = m.Path[^1];
        if (last is int index) target!.AsArray()[index] = JsonNode.Parse(m.Replacement!);
        else if (m.Replacement == null) target!.AsObject().Remove((string)last);
        else target!.AsObject()[(string)last] = JsonNode.Parse(m.Replacement);
        return copy;
    }

    [Fact]
    public void AgreesWithJsonSchemaNetOnMutatedDocuments()
    {
        var valid = Cases().Where(c => (bool)c[1]).Select(c => Contracts.ReadJson($"fixtures/documents/{c[0]}")).ToList();
        var compared = 0;
        var disagreements = new List<string>();
        foreach (var doc in valid)
        {
            foreach (var m in Mutations(doc, []).ToList())
            {
                var mutated = Apply(doc, m);
                var expected = SchemaValid(mutated);
                var actual = DocumentResolver.CheckSchema(mutated).Count == 0;
                compared++;
                if (expected != actual)
                {
                    var shown = m.Replacement ?? "(deleted)";
                    disagreements.Add($"/{string.Join('/', m.Path)} = {shown[..Math.Min(40, shown.Length)]}: schema {expected}, CheckSchema {actual}");
                }
            }
        }
        output.WriteLine($"compared {compared} mutated documents");
        Assert.Empty(disagreements.Take(20));
        Assert.True(compared > 5000, $"only {compared} comparisons");
    }
}

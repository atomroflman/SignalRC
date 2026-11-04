using System.Text.Json.Nodes;
using SignalRC.Server.Overlay;

namespace SignalRC.Overlay.Tests.Overlay;

public class JsonPatchTests
{
    private static string Apply(string doc, string patch) =>
        JsonPatch.Apply(JsonNode.Parse(doc)!, (JsonArray)JsonNode.Parse(patch)!).ToJsonString();

    [Theory]
    [InlineData("""{"a":1}""", """[{"op":"add","path":"/b","value":2}]""", """{"a":1,"b":2}""")]
    [InlineData("""{"a":1}""", """[{"op":"replace","path":"/a","value":null}]""", """{"a":null}""")]
    [InlineData("""{"a":{"b":1}}""", """[{"op":"remove","path":"/a/b"}]""", """{"a":{}}""")]
    [InlineData("""{"l":[1,2]}""", """[{"op":"add","path":"/l/1","value":9}]""", """{"l":[1,9,2]}""")]
    [InlineData("""{"l":[1,2]}""", """[{"op":"add","path":"/l/-","value":3}]""", """{"l":[1,2,3]}""")]
    [InlineData("""{"l":[1,2]}""", """[{"op":"remove","path":"/l/0"}]""", """{"l":[2]}""")]
    [InlineData("""{"a/b":1,"c~d":2}""", """[{"op":"replace","path":"/a~1b","value":3},{"op":"remove","path":"/c~0d"}]""", """{"a/b":3}""")]
    [InlineData("""{"a":1}""", """[{"op":"replace","path":"","value":{"z":0}}]""", """{"z":0}""")]
    public void AppliesOperations(string doc, string patch, string expected) =>
        Assert.Equal(expected, Apply(doc, patch));

    [Theory]
    [InlineData("""[{"op":"replace","path":"/missing","value":1}]""")]
    [InlineData("""[{"op":"remove","path":"/missing"}]""")]
    [InlineData("""[{"op":"add","path":"/x/y","value":1}]""")]
    [InlineData("""[{"op":"add","path":"/l/5","value":1}]""")]
    [InlineData("""[{"op":"add","path":"/l/01","value":1}]""")]
    [InlineData("""[{"op":"add","path":"/a"}]""")]
    [InlineData("""[{"op":"copy","path":"/a","from":"/l"}]""")]
    [InlineData("""[{"op":"remove","path":""}]""")]
    [InlineData("""[{"op":"add","path":"a","value":1}]""")]
    public void RejectsInvalidOperations(string patch) =>
        Assert.Throws<JsonPatch.PatchException>(() => Apply("""{"a":1,"l":[0]}""", patch));

    [Fact]
    public void LeavesTheInputUntouched()
    {
        var doc = JsonNode.Parse("""{"a":1}""")!;
        JsonPatch.Apply(doc, (JsonArray)JsonNode.Parse("""[{"op":"remove","path":"/a"}]""")!);
        Assert.Equal("""{"a":1}""", doc.ToJsonString());
    }
}

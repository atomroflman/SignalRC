using System.Text.Json.Nodes;
using SignalRC.Server.Overlay.Documents;

namespace SignalRC.Overlay.Tests.Documents;

public class ReferencesTests
{
    private static string Describe(SourceReference r) =>
        $"{r.Kind}:{r.Name}@{r.Location.Variant}/{r.Location.Element}/{r.Location.Part}/{r.Location.Property}/{r.Location.Clip}/{r.Location.Field}";

    [Fact]
    public void ListsFormulaLidarAndStalenessReferencesWithTheirLocation()
    {
        var doc = JsonNode.Parse("""
            { "schemaVersion": 1, "workspace": { "width": 100, "height": 100 },
              "sources": { "telemetry": { "volt": { "staleAfterMs": 1000 } } },
              "elements": {
                "e_v": { "type": "valueText", "disabled": true, "props": { "value": { "base": null, "binding": { "expr": "tel(\"speed\") + tel(\"speed\") + if(driverActive(), out(\"steering\"), 0)" } } } },
                "e_l": { "type": "lidarWidget", "source": "grid" } },
              "children": ["e_v", "e_l"],
              "clips": { "c_1": { "durationS": 1, "trigger": { "mode": "whileTrue", "condition": "sig(\"brake\") > 0" }, "tracks": [] } },
              "variants": { "cam": { "elements": { "e_v": { "props": { "value": { "base": null, "binding": { "expr": "tel(\"rpm\" +" } } } } },
                                     "addedElements": { "e_x": { "type": "valueText", "props": { "value": { "base": null, "binding": { "expr": "tel(\"temp\")" } } } } },
                                     "structure": { "order": { "root": ["e_v", "e_l", "e_x"] } } } } }
            """)!.AsObject();
        Assert.Equal(
            [
                "Tel:speed@/e_v//value//",
                "Tel:speed@/e_v//value//",
                "Out:steering@/e_v//value//",
                "Sig:brake@////c_1/trigger.condition",
                // The variant override "tel(\"rpm\" +" does not parse and contributes nothing.
                "Tel:temp@cam/e_x//value//",
                "Tel:grid@/e_l////source",
                "Tel:volt@/////sources.telemetry",
            ],
            DocumentResolver.SourceReferences(doc).Select(Describe));
    }

    [Fact]
    public void ReturnsNothingForASchemaInvalidDocument()
    {
        Assert.Empty(DocumentResolver.SourceReferences(new JsonObject { ["schemaVersion"] = 2 }));
    }
}

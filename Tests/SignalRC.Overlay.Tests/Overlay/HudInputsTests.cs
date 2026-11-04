using System.Text.Json.Nodes;
using SignalRC.Server.Overlay;

namespace SignalRC.Overlay.Tests.Overlay;

// D75: which viewer clicks reach the driver, and with which value.
public class HudInputsTests
{
    private static readonly JsonNode Doc = JsonNode.Parse("""
    {
      "elements": {
        "horn": { "type": "rect", "interaction": { "input": "horn", "kind": "button", "public": true } },
        "light": { "type": "rect", "interaction": { "input": "light", "kind": "toggle", "value": 2, "public": true } },
        "private": { "type": "rect", "interaction": { "input": "secret", "kind": "toggle" } },
        "panel": {
          "type": "svgAsset",
          "interaction": { "input": "whole", "kind": "value", "public": false },
          "parts": {
            "eco": { "interaction": { "input": "mode", "kind": "value", "value": 1, "public": true } },
            "power": { "interaction": { "input": "power", "kind": "slider", "min": 0.2, "max": 1, "public": true } },
            "broken": { "interaction": { "input": "x", "kind": "slider", "min": 1, "max": 1, "public": true } }
          }
        }
      },
      "variants": {
        "cam2": { "addedElements": { "extra": { "type": "rect", "interaction": { "input": "beacon", "kind": "toggle", "public": true } } } }
      }
    }
    """)!;

    [Fact]
    public void ButtonPressAndRelease()
    {
        Assert.Equal(new HudInputCommand("horn", "press", 1), HudInputs.Resolve(Doc, "horn", null, "press", 99));
        Assert.Equal(new HudInputCommand("horn", "release", 0), HudInputs.Resolve(Doc, "horn", null, "release", 99));
        Assert.Null(HudInputs.Resolve(Doc, "horn", null, "set", 1));
    }

    [Fact]
    public void ValueComesFromTheDocument()
    {
        Assert.Equal(new HudInputCommand("light", "toggle", 2), HudInputs.Resolve(Doc, "light", null, "toggle", 7));
        Assert.Equal(new HudInputCommand("mode", "set", 1), HudInputs.Resolve(Doc, "panel", "eco", "set", 5));
    }

    [Fact]
    public void SliderIsClampedToItsRange()
    {
        Assert.Equal(new HudInputCommand("power", "set", 0.5), HudInputs.Resolve(Doc, "panel", "power", "set", 0.5));
        Assert.Equal(new HudInputCommand("power", "set", 1), HudInputs.Resolve(Doc, "panel", "power", "set", 50));
        Assert.Equal(new HudInputCommand("power", "set", 0.2), HudInputs.Resolve(Doc, "panel", "power", "set", -3));
        Assert.Null(HudInputs.Resolve(Doc, "panel", "power", "set", double.NaN));
        Assert.Null(HudInputs.Resolve(Doc, "panel", "broken", "set", 1));
    }

    [Fact]
    public void ElementsAddedByAVariant() =>
        Assert.Equal(new HudInputCommand("beacon", "toggle", 1), HudInputs.Resolve(Doc, "extra", null, "toggle", 0));

    [Fact]
    public void OnlyPublicExistingInteractions()
    {
        Assert.Null(HudInputs.Resolve(Doc, "private", null, "toggle", 1));
        Assert.Null(HudInputs.Resolve(Doc, "panel", null, "set", 1));
        Assert.Null(HudInputs.Resolve(Doc, "panel", "missing", "set", 1));
        Assert.Null(HudInputs.Resolve(Doc, "missing", null, "press", 1));
        Assert.Null(HudInputs.Resolve(null, "horn", null, "press", 1));
    }
}

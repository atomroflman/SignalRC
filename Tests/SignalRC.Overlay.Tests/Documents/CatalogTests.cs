using SignalRC.Overlay.Tests.Testing;
using SignalRC.Server.Overlay.Documents;

namespace SignalRC.Overlay.Tests.Documents;

public class CatalogTests
{
    [Fact]
    public void EmbedsSharedCatalog()
    {
        using var stream = typeof(PropertyCatalog).Assembly.GetManifestResourceStream(PropertyCatalog.ResourceName)!;
        using var reader = new StreamReader(stream);
        Assert.Equal(Contracts.ReadText("catalog/property-catalog.json"), reader.ReadToEnd());
        Assert.Contains("lidarWidget", PropertyCatalog.ElementTypes);
    }
}

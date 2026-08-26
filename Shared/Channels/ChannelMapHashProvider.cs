using System.Text.Json;

namespace SignalRC.Shared.Channels;

public static class ChannelMapHashProvider
{
    public static string GenerateHash(ChannelMap channelMap)
    {
        // Serialize the ChannelMap to JSON
        var json = JsonSerializer.Serialize(channelMap, new JsonSerializerOptions
        {
            WriteIndented = false,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        });

        // Use shared hash utility
        return HashUtility.GenerateSha256HashLowercase(json);
    }
}
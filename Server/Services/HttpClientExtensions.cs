using System.Text.Json;

public static class HttpClientExtensions
{
    public static async Task<TResponse> PostJsonAsync<TRequest, TResponse>(this HttpClient client, string path, TRequest content, ILogger? logger = null, string? reason = null)
    {
        try 
        {
            var json = JsonSerializer.Serialize(content);
            logger?.LogDebug($"{reason}{(reason == null ? "" : " ")}POST {path} with payload: {json}");
            var response = await client.PostAsync(path, new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
            response.EnsureSuccessStatusCode();
            var responseJson = await response.Content.ReadAsStringAsync();
            logger?.LogDebug($"{reason}{(reason == null ? "" : " ")}Response from {path}: {responseJson}");
            return JsonSerializer.Deserialize<TResponse>(responseJson)!;
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, $"{reason}{(reason == null ? "" : " ")}Error during POST {path}");
            throw;
        }
    }
}
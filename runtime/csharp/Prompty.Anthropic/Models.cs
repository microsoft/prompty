// Copyright (c) Microsoft. All rights reserved.

using System.Net.Http.Headers;
using System.Text.Json;
using Prompty.Core;

namespace Prompty.Anthropic;

/// <summary>
/// Lists Anthropic models and maps provider payloads to generated model types.
/// </summary>
public sealed class AnthropicModelLister : IModelLister
{
    /// <inheritdoc />
    public async Task<List<ModelInfo>> ListModelsAsync(object connection)
    {
        if (connection is not Connection typedConnection)
            throw new ArgumentException("Anthropic model listing requires a generated Connection.", nameof(connection));

        return [.. await AnthropicModels.ListModelsAsync(typedConnection)];
    }
}

/// <summary>
/// Model discovery for the Anthropic Models API.
/// </summary>
public static class AnthropicModels
{
    private const string DefaultEndpoint = "https://api.anthropic.com";
    private const string ApiVersion = "2023-06-01";
    private static readonly HttpClient HttpClient = new();

    /// <summary>
    /// List all available Anthropic models, following cursor-based pagination.
    /// </summary>
    public static async Task<IReadOnlyList<ModelInfo>> ListModelsAsync(
        Connection connection,
        CancellationToken cancellationToken = default)
    {
        if (connection is not ApiKeyConnection keyConnection)
            throw new InvalidOperationException(
                $"Connection kind '{connection.Kind}' is not supported for Anthropic model listing. Use 'key'.");

        var apiKey = string.IsNullOrWhiteSpace(keyConnection.ApiKey)
            ? Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY")
            : keyConnection.ApiKey;
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException(
                "Anthropic API key is required. Set connection.apiKey or ANTHROPIC_API_KEY.");

        var endpoint = string.IsNullOrWhiteSpace(keyConnection.Endpoint)
            ? DefaultEndpoint
            : keyConnection.Endpoint.TrimEnd('/');
        var models = new List<ModelInfo>();
        string? afterId = null;

        do
        {
            var query = afterId is null
                ? "limit=100"
                : $"limit=100&after_id={Uri.EscapeDataString(afterId)}";
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{endpoint}/v1/models?{query}");
            request.Headers.Add("x-api-key", apiKey);
            request.Headers.Add("anthropic-version", ApiVersion);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            using var response = await HttpClient.SendAsync(request, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException(
                    $"Anthropic list models failed: {(int)response.StatusCode} {response.ReasonPhrase} - " +
                    body[..Math.Min(body.Length, 300)]);

            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("data", out var data)
                && data.ValueKind == JsonValueKind.Array)
            {
                models.AddRange(data.EnumerateArray().Select(MapModel));
            }

            var hasMore = document.RootElement.TryGetProperty("has_more", out var hasMoreValue)
                && hasMoreValue.ValueKind == JsonValueKind.True;
            afterId = hasMore
                && document.RootElement.TryGetProperty("last_id", out var lastId)
                && lastId.ValueKind == JsonValueKind.String
                    ? lastId.GetString()
                    : null;
        }
        while (afterId is not null);

        return models.AsReadOnly();
    }

    /// <summary>
    /// Map a raw Anthropic model payload to the generated provider-neutral contract.
    /// </summary>
    public static ModelInfo MapModel(JsonElement model)
    {
        var info = new ModelInfo
        {
            Id = GetString(model, "id") ?? string.Empty,
            DisplayName = GetString(model, "display_name"),
            OwnedBy = "anthropic",
            ContextWindow = GetInt(model, "context_length"),
            InputModalities = GetStringList(model, "input_modalities"),
            OutputModalities = GetStringList(model, "output_modalities"),
            AdditionalProperties = ModelDiscovery.PreserveRaw(model),
        };
        ModelDiscovery.Enrich("anthropic", info);
        return info;
    }

    private static string? GetString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? GetInt(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetInt32(out var number)
            ? number
            : null;

    private static IList<string>? GetStringList(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array
            ? value.EnumerateArray().Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => item.GetString()!).ToArray()
            : null;
}

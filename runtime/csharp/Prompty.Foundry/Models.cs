// Copyright (c) Microsoft. All rights reserved.

using System.ClientModel;
using System.ClientModel.Primitives;
using System.Net.Http.Headers;
using System.Text.Json;
using Azure.AI.OpenAI;
using Azure.Identity;
using OpenAI;
using Prompty.Core;

namespace Prompty.Foundry;

/// <summary>
/// Model discovery for Azure OpenAI / Microsoft Foundry endpoints.
/// Creates the appropriate client (API key or Entra ID) and delegates
/// listing and enrichment to <see cref="OpenAI.OpenAIModels"/>.
/// </summary>
public static class FoundryModels
{
    private const string DefaultApiVersion = "2024-12-01-preview";
    private const string AiScope = "https://ai.azure.com/.default";

    public sealed record FoundryDeploymentClient(string ProjectEndpoint, Func<CancellationToken, Task<string>> GetTokenAsync);

    /// <summary>
    /// List models available from an Azure OpenAI / Foundry endpoint.
    /// </summary>
    public static async Task<IReadOnlyList<ModelInfo>> ListModelsAsync(
        Connection connection, CancellationToken cancellationToken = default)
    {
        if (connection is FoundryConnection foundryConn)
        {
            if (string.IsNullOrEmpty(foundryConn.Endpoint))
                throw new InvalidOperationException("Foundry endpoint is required to list deployments.");

            var credential = new DefaultAzureCredential();
            return await ListDeploymentsAsync(
                new FoundryDeploymentClient(
                    foundryConn.Endpoint,
                    async ct => (await credential.GetTokenAsync(new Azure.Core.TokenRequestContext([AiScope]), ct)).Token),
                cancellationToken);
        }

        if (connection is ReferenceConnection refConn)
        {
            var registered = ConnectionRegistry.Get(refConn.Name!)
                ?? throw new InvalidOperationException(
                    $"Connection '{refConn.Name}' not found in ConnectionRegistry. " +
                    $"Call ConnectionRegistry.Register(\"{refConn.Name}\", client) first.");
            if (registered is FoundryDeploymentClient deploymentClient)
                return await ListDeploymentsAsync(deploymentClient, cancellationToken);
        }

        var client = CreateClient(connection);
        return await OpenAI.OpenAIModels.ListModelsAsync(client, cancellationToken);
    }

    private static async Task<IReadOnlyList<ModelInfo>> ListDeploymentsAsync(
        FoundryDeploymentClient client,
        CancellationToken cancellationToken)
    {
        using var http = new HttpClient();
        var token = await client.GetTokenAsync(cancellationToken);
        var endpoint = client.ProjectEndpoint.TrimEnd('/');
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{endpoint}/deployments?api-version=v1");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var response = await http.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"Failed to list Foundry deployments: {(int)response.StatusCode} {response.ReasonPhrase} — {body[..Math.Min(body.Length, 300)]}");

        using var document = JsonDocument.Parse(body);
        var models = new List<ModelInfo>();
        if (!document.RootElement.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Array)
            return models.AsReadOnly();

        foreach (var deployment in value.EnumerateArray())
        {
            models.Add(MapDeployment(deployment));
        }

        return models.AsReadOnly();
    }

    private static ModelInfo MapDeployment(JsonElement deployment)
    {
        var properties = TryGetObject(deployment, "properties");
        var model = properties is not null ? TryGetObject(properties.Value, "model") : null;
        var capabilities = properties is not null ? TryGetObject(properties.Value, "capabilities") : null;
        capabilities ??= model is not null ? TryGetObject(model.Value, "capabilities") : null;

        return new ModelInfo
        {
            Id = GetString(deployment, "name") ?? string.Empty,
            DisplayName = model is not null ? GetString(model.Value, "name") : null,
            OwnedBy = model is not null ? GetString(model.Value, "publisher") ?? "azure" : "azure",
            ContextWindow = capabilities is not null
                ? GetInt(capabilities.Value, "maxContextLength", "contextWindow", "context_length")
                : model is not null ? GetInt(model.Value, "maxContextLength") : null,
            InputModalities = capabilities is not null
                ? GetStringList(capabilities.Value, "inputModalities", "input_modalities", "supportedInputModalities")
                : null,
            OutputModalities = capabilities is not null
                ? GetStringList(capabilities.Value, "outputModalities", "output_modalities", "supportedOutputModalities")
                : null,
            AdditionalProperties = new Dictionary<string, object> { ["deployment"] = deployment.Clone() },
        };
    }

    private static JsonElement? TryGetObject(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object ? value : null;

    private static string? GetString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static int? GetInt(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (!element.TryGetProperty(name, out var value))
                continue;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
                return number;
            if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number))
                return number;
        }
        return null;
    }

    private static IList<string>? GetStringList(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (!element.TryGetProperty(name, out var value))
                continue;
            if (value.ValueKind == JsonValueKind.Array)
                return value.EnumerateArray().Select(v => v.ToString()).ToList();
            if (value.ValueKind == JsonValueKind.String)
                return value.GetString()?.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        }
        return null;
    }

    private static OpenAIClient CreateClient(Connection connection)
    {
        if (connection is ReferenceConnection refConn)
        {
            var client = ConnectionRegistry.Get(refConn.Name!)
                ?? throw new InvalidOperationException(
                    $"Connection '{refConn.Name}' not found in ConnectionRegistry. " +
                    $"Call ConnectionRegistry.Register(\"{refConn.Name}\", client) first.");
            return (OpenAIClient)client;
        }

        string? endpoint = null;
        string? apiKey = null;

        if (connection is ApiKeyConnection keyConn)
        {
            endpoint = keyConn.Endpoint;
            apiKey = keyConn.ApiKey;
        }
        else
        {
            throw new InvalidOperationException(
                $"Connection kind '{connection.Kind}' is not supported for Foundry model listing. " +
                "Use 'foundry' for project deployments, 'key' for Azure OpenAI model catalogs, or 'reference'.");
        }

        if (string.IsNullOrEmpty(endpoint))
            throw new InvalidOperationException(
                "Azure/Foundry endpoint is required. Set connection.endpoint or ${env:AZURE_OPENAI_ENDPOINT}.");

        if (!string.IsNullOrEmpty(apiKey))
            return CreateApiKeyClient(endpoint, apiKey);

        return CreateEntraIdClient(endpoint);
    }

    private static OpenAIClient CreateApiKeyClient(string endpoint, string apiKey)
    {
        // Base endpoint for model listing — no deployment scoping
        var baseEndpoint = new Uri($"{endpoint.TrimEnd('/')}/openai");

        var clientOptions = new OpenAIClientOptions
        {
            Endpoint = baseEndpoint,
        };

        clientOptions.AddPolicy(
            new AzureApiVersionPolicy(DefaultApiVersion),
            PipelinePosition.BeforeTransport);

        clientOptions.AddPolicy(
            new AzureApiKeyAuthPolicy(apiKey),
            PipelinePosition.BeforeTransport);

        return new OpenAIClient(new ApiKeyCredential("azure-api-key"), clientOptions);
    }

    private static AzureOpenAIClient CreateEntraIdClient(string endpoint)
    {
        return new AzureOpenAIClient(
            new Uri(endpoint.TrimEnd('/')),
            new DefaultAzureCredential());
    }
}

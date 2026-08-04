// Copyright (c) Microsoft. All rights reserved.

using System.ClientModel;
using System.Text.Json;
using OpenAI;
using OpenAI.Models;
using Prompty.Core;

namespace Prompty.OpenAI;

/// <summary>
/// OpenAI implementation of the generated model-listing protocol.
/// </summary>
public sealed class OpenAIModelLister : IModelLister
{
    /// <inheritdoc />
    public async Task<List<ModelInfo>> ListModelsAsync(object connection)
    {
        if (connection is not Connection typedConnection)
            throw new ArgumentException("OpenAI model listing requires a generated Connection.", nameof(connection));

        return [.. await OpenAIModels.ListModelsAsync(typedConnection)];
    }
}

/// <summary>
/// Model discovery for OpenAI — lists available models and enriches
/// sparse API responses with known context window and modality metadata.
/// </summary>
public static class OpenAIModels
{
    /// <summary>
    /// List models available from an OpenAI endpoint using connection credentials.
    /// </summary>
    public static async Task<IReadOnlyList<ModelInfo>> ListModelsAsync(
        Connection connection, CancellationToken cancellationToken = default)
    {
        var client = CreateClient(connection);
        return await ListModelsAsync(client, cancellationToken);
    }

    /// <summary>
    /// List models using a pre-configured <see cref="OpenAIClient"/>.
    /// Useful when the caller already has a client from <see cref="ConnectionRegistry"/>
    /// or manual construction.
    /// </summary>
    public static async Task<IReadOnlyList<ModelInfo>> ListModelsAsync(
        OpenAIClient client, CancellationToken cancellationToken = default)
    {
        var modelClient = client.GetOpenAIModelClient();
        var result = await modelClient.GetModelsAsync(cancellationToken);

        var models = new List<ModelInfo>();
        foreach (var m in result.Value)
        {
            var info = new ModelInfo
            {
                Id = m.Id,
                OwnedBy = m.OwnedBy,
                AdditionalProperties = new Dictionary<string, object?>
                {
                    ["id"] = m.Id,
                    ["object"] = "model",
                    ["created"] = m.CreatedAt.ToUnixTimeSeconds(),
                    ["owned_by"] = m.OwnedBy,
                },
            };
            ModelDiscovery.Enrich("openai", info);
            models.Add(info);
        }

        return models.AsReadOnly();
    }

    /// <summary>
    /// Enrich a <see cref="ModelInfo"/> with known context window and modality data.
    /// Matches exact IDs first, then falls back to prefix matching for versioned
    /// model names (e.g. "gpt-4o-2024-08-06" → "gpt-4o").
    /// </summary>
    internal static void Enrich(ModelInfo info)
    {
        ModelDiscovery.Enrich("openai", info);
    }

    /// <summary>
    /// Map a raw OpenAI model payload to the generated provider-neutral contract.
    /// </summary>
    public static ModelInfo MapModel(JsonElement model)
    {
        var info = new ModelInfo
        {
            Id = model.TryGetProperty("id", out var id) ? id.GetString() ?? string.Empty : string.Empty,
            OwnedBy = model.TryGetProperty("owned_by", out var ownedBy) ? ownedBy.GetString() : null,
            AdditionalProperties = ModelDiscovery.PreserveRaw(model),
        };
        ModelDiscovery.Enrich("openai", info);
        return info;
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

        if (connection is ApiKeyConnection keyConn)
        {
            if (string.IsNullOrEmpty(keyConn.ApiKey))
                throw new InvalidOperationException(
                    "OpenAI API key is required. Set connection.apiKey or ${env:OPENAI_API_KEY}.");

            if (!string.IsNullOrEmpty(keyConn.Endpoint))
            {
                var options = new OpenAIClientOptions { Endpoint = new Uri(keyConn.Endpoint) };
                return new OpenAIClient(new ApiKeyCredential(keyConn.ApiKey), options);
            }

            return new OpenAIClient(keyConn.ApiKey);
        }

        throw new InvalidOperationException(
            $"Connection kind '{connection.Kind}' is not supported for model listing. " +
            "Use 'key' (with apiKey) or 'reference' (with ConnectionRegistry).");
    }
}

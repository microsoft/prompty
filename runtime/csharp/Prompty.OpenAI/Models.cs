// Copyright (c) Microsoft. All rights reserved.

using System.ClientModel;
using OpenAI;
using OpenAI.Models;
using Prompty.Core;

namespace Prompty.OpenAI;

/// <summary>
/// Model discovery for OpenAI — lists available models and enriches
/// sparse API responses with known context window and modality metadata.
/// </summary>
public static class OpenAIModels
{
    /// <summary>
    /// Known model metadata used to enrich the sparse data returned by GET /v1/models.
    /// Keys are sorted by descending length so prefix matching finds the most specific
    /// match first (e.g. "gpt-4o-mini" before "gpt-4o" before "gpt-4").
    /// </summary>
    private static readonly (string Key, int? ContextWindow, string[] Inputs, string[] Outputs)[] KnownModels =
    [
        ("text-embedding-3-large", 8191, ["text"], []),
        ("text-embedding-3-small", 8191, ["text"], []),
        ("gpt-3.5-turbo", 16385, ["text"], ["text"]),
        ("gpt-4o-mini", 128000, ["text", "image"], ["text"]),
        ("gpt-4-turbo", 128000, ["text", "image"], ["text"]),
        ("dall-e-3", null, ["text"], ["image"]),
        ("gpt-4o", 128000, ["text", "image"], ["text"]),
        ("gpt-4", 8192, ["text"], ["text"]),
    ];

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
            };
            Enrich(info);
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
        foreach (var (key, contextWindow, inputs, outputs) in KnownModels)
        {
            if (string.Equals(info.Id, key, StringComparison.OrdinalIgnoreCase)
                || info.Id.StartsWith(key + "-", StringComparison.OrdinalIgnoreCase))
            {
                info.ContextWindow = contextWindow;
                info.InputModalities = inputs;
                info.OutputModalities = outputs;
                return;
            }
        }
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

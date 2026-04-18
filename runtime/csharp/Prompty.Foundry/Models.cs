// Copyright (c) Microsoft. All rights reserved.

using System.ClientModel;
using System.ClientModel.Primitives;
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

    /// <summary>
    /// List models available from an Azure OpenAI / Foundry endpoint.
    /// </summary>
    public static async Task<IReadOnlyList<ModelInfo>> ListModelsAsync(
        Connection connection, CancellationToken cancellationToken = default)
    {
        var client = CreateClient(connection);
        return await OpenAI.OpenAIModels.ListModelsAsync(client, cancellationToken);
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
        else if (connection is FoundryConnection foundryConn)
        {
            endpoint = foundryConn.Endpoint;
        }
        else
        {
            throw new InvalidOperationException(
                $"Connection kind '{connection.Kind}' is not supported for Foundry model listing. " +
                "Use 'foundry', 'key', or 'reference'.");
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

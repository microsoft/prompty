// Copyright (c) Microsoft. All rights reserved.

using System.ClientModel;
using System.ClientModel.Primitives;
using Azure.AI.OpenAI;
using Azure.Identity;
using OpenAI;
using Prompty.Core;

namespace Prompty.Foundry;

/// <summary>
/// Executes LLM calls against Azure OpenAI / Microsoft Foundry endpoints.
/// <para>
/// For API key auth: uses the base OpenAI SDK with pipeline policies for Azure auth and API versioning.
/// For Entra ID auth: uses <see cref="AzureOpenAIClient"/> which natively handles bearer token auth
/// via <see cref="DefaultAzureCredential"/>.
/// </para>
/// Registered under keys "foundry" and "azure" (deprecated alias).
/// </summary>
public class FoundryExecutor : OpenAI.OpenAIExecutor
{
    private const string DefaultApiVersion = "2024-12-01-preview";

    protected override OpenAIClient CreateClient(Core.Prompty agent)
    {
        var conn = agent.Model?.Connection;

        // §11.1: ReferenceConnection → look up pre-configured client from registry
        if (conn is ReferenceConnection refConn)
        {
            var client = ConnectionRegistry.Get(refConn.Name!)
                ?? throw new InvalidOperationException(
                    $"Connection '{refConn.Name}' not found in ConnectionRegistry. " +
                    $"Call ConnectionRegistry.Register(\"{refConn.Name}\", client) first.");
            return (OpenAIClient)client;
        }

        string? endpoint = null;
        string? apiKey = null;

        if (conn is ApiKeyConnection keyConn)
        {
            endpoint = keyConn.Endpoint;
            apiKey = keyConn.ApiKey;
        }
        else if (conn is FoundryConnection foundryConn)
        {
            endpoint = foundryConn.Endpoint;
            // FoundryConnection uses Entra ID auth — no API key
        }
        else
        {
            var kind = conn?.Kind ?? "unknown";
            throw new InvalidOperationException(
                $"Connection kind '{kind}' is not supported by the Foundry executor. " +
                "Use 'foundry' (with endpoint + DefaultAzureCredential), " +
                "'key' (with apiKey), or 'reference' (with ConnectionRegistry).");
        }

        if (string.IsNullOrEmpty(endpoint))
            throw new InvalidOperationException(
                "Azure/Foundry endpoint is required. Set model.connection.endpoint or ${env:AZURE_OPENAI_ENDPOINT}.");

        _ = agent.Model?.Id
            ?? throw new InvalidOperationException("Model ID (deployment name) is required for Azure/Foundry.");

        if (!string.IsNullOrEmpty(apiKey))
        {
            return CreateApiKeyClient(endpoint, agent.Model!.Id!, apiKey);
        }

        // Entra ID auth — AzureOpenAIClient natively handles DefaultAzureCredential,
        // deployment-based URL routing, and API version query parameter.
        return CreateEntraIdClient(endpoint);
    }

    private static OpenAIClient CreateApiKeyClient(string endpoint, string model, string apiKey)
    {
        // Build deployment-scoped endpoint:
        // {endpoint}/openai/deployments/{deployment}
        // The OpenAI SDK appends /chat/completions, /embeddings, etc.
        var deploymentEndpoint = new Uri($"{endpoint.TrimEnd('/')}/openai/deployments/{model}");

        var clientOptions = new OpenAIClientOptions
        {
            Endpoint = deploymentEndpoint,
        };

        clientOptions.AddPolicy(
            new AzureApiVersionPolicy(DefaultApiVersion),
            PipelinePosition.BeforeTransport);

        clientOptions.AddPolicy(
            new AzureApiKeyAuthPolicy(apiKey),
            PipelinePosition.BeforeTransport);

        // Dummy credential — real auth handled by pipeline policy
        return new OpenAIClient(new ApiKeyCredential("azure-api-key"), clientOptions);
    }

    private static AzureOpenAIClient CreateEntraIdClient(string endpoint)
    {
        var options = new AzureOpenAIClientOptions();

        // Patch: Azure.AI.OpenAI may swap max_completion_tokens → max_tokens.
        // This policy ensures the correct parameter name reaches the API.
        options.AddPolicy(
            new MaxTokensPatchPolicy(),
            PipelinePosition.BeforeTransport);

        return new AzureOpenAIClient(
            new Uri(endpoint.TrimEnd('/')),
            new DefaultAzureCredential(),
            options);
    }
}


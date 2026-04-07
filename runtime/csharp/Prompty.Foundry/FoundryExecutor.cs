// Copyright (c) Microsoft. All rights reserved.

using System.ClientModel;
using System.ClientModel.Primitives;
using Azure.Identity;
using OpenAI;
using Prompty.Core;

namespace Prompty.Foundry;

/// <summary>
/// Executes LLM calls against Azure OpenAI / Microsoft Foundry endpoints.
/// Uses the OpenAI SDK directly with pipeline policies for Azure auth and API versioning,
/// matching the pattern used by Python (openai.AzureOpenAI) and TypeScript (openai.AzureOpenAI).
/// Registered under keys "foundry" and "azure" (deprecated alias).
/// </summary>
public class FoundryExecutor : OpenAI.OpenAIExecutor
{
    private const string DefaultApiVersion = "2024-12-01-preview";
    private static readonly string[] CognitiveServicesScopes = ["https://cognitiveservices.azure.com/.default"];

    protected override OpenAIClient CreateClient(Core.Prompty agent)
    {
        var conn = agent.Model?.Connection;
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

        if (string.IsNullOrEmpty(endpoint))
            throw new InvalidOperationException(
                "Azure/Foundry endpoint is required. Set model.connection.endpoint or ${env:AZURE_OPENAI_ENDPOINT}.");

        var model = agent.Model?.Id
            ?? throw new InvalidOperationException("Model ID (deployment name) is required for Azure/Foundry.");

        // Build deployment-scoped endpoint:
        // {endpoint}/openai/deployments/{deployment}
        // The OpenAI SDK appends /chat/completions, /embeddings, etc.
        var deploymentEndpoint = new Uri($"{endpoint.TrimEnd('/')}/openai/deployments/{model}");

        var clientOptions = new OpenAIClientOptions
        {
            Endpoint = deploymentEndpoint,
        };

        // Always add api-version (required by Azure OpenAI)
        clientOptions.AddPolicy(
            new AzureApiVersionPolicy(DefaultApiVersion),
            PipelinePosition.BeforeTransport);

        if (!string.IsNullOrEmpty(apiKey))
        {
            // API key auth — replace SDK's Authorization header with Azure's api-key header
            clientOptions.AddPolicy(
                new AzureApiKeyAuthPolicy(apiKey),
                PipelinePosition.BeforeTransport);

            // Dummy credential — real auth handled by the pipeline policy
            return new OpenAIClient(new ApiKeyCredential("azure-api-key"), clientOptions);
        }

        // Entra ID auth — use DefaultAzureCredential for bearer token
        clientOptions.AddPolicy(
            new AzureBearerTokenPolicy(new DefaultAzureCredential(), CognitiveServicesScopes),
            PipelinePosition.BeforeTransport);

        return new OpenAIClient(new ApiKeyCredential("azure-entra-id"), clientOptions);
    }
}


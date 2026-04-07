// Copyright (c) Microsoft. All rights reserved.

using Azure;
using Azure.AI.OpenAI;
using Azure.Identity;
using OpenAI;
using Prompty.Core;

namespace Prompty.Foundry;

/// <summary>
/// Executes LLM calls against Azure OpenAI / Microsoft Foundry endpoints.
/// Inherits all wire format and dispatch logic from OpenAIExecutor.
/// Registered under keys "foundry" and "azure" (deprecated alias).
/// </summary>
public class FoundryExecutor : OpenAI.OpenAIExecutor
{
    private const string DefaultApiVersion = "2024-12-01-preview";

    protected override OpenAIClient CreateClient(Core.Prompty agent)
    {
        var conn = agent.Model?.Connection;
        string? endpoint = null;
        string? apiKey = null;

        if (conn is Prompty.Core.ApiKeyConnection keyConn)
        {
            endpoint = keyConn.Endpoint;
            apiKey = keyConn.ApiKey;
        }
        else if (conn is Prompty.Core.FoundryConnection foundryConn)
        {
            endpoint = foundryConn.Endpoint;
            // FoundryConnection uses Entra ID auth — no API key
        }

        if (string.IsNullOrEmpty(endpoint))
            throw new InvalidOperationException(
                "Azure/Foundry endpoint is required. Set model.connection.endpoint or ${env:AZURE_OPENAI_ENDPOINT}.");

        var endpointUri = new Uri(endpoint);

        // If API key is available, use it; otherwise fall back to DefaultAzureCredential
        if (!string.IsNullOrEmpty(apiKey))
        {
            return new AzureOpenAIClient(endpointUri, new AzureKeyCredential(apiKey));
        }

        return new AzureOpenAIClient(endpointUri, new DefaultAzureCredential());
    }
}

// Copyright (c) Microsoft. All rights reserved.

using System.ClientModel;
using Azure.Identity;
using Prompty.Core;
using Prompty.Foundry;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — Entra ID (Azure AD) authentication against Azure OpenAI via Foundry provider.
/// Uses AzureOpenAIClient with DefaultAzureCredential (no API key).
/// Requires AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_CHAT_DEPLOYMENT env vars.
/// Skips gracefully when Azure credentials are not available (run `az login` first).
/// </summary>
[Trait("Category", "Integration")]
public class EntraIdTests : IntegrationTestBase
{
    /// <summary>
    /// Whether the required Azure endpoint env vars (but NOT api key) are set.
    /// </summary>
    private static bool HasAzureEndpoint =>
        !string.IsNullOrEmpty(AzureOpenAIEndpoint)
        && !string.IsNullOrEmpty(AzureOpenAIChatDeployment);

    /// <summary>
    /// Build an Azure/Foundry agent that authenticates via Entra ID (DefaultAzureCredential).
    /// Uses connection kind "foundry" which the FoundryExecutor routes through AzureOpenAIClient.
    /// </summary>
    private static Core.Prompty MakeEntraIdAgent(
        string apiType = "chat",
        string? deployment = null,
        ModelOptions? options = null)
    {
        var endpoint = GetEnvOrSkip("AZURE_OPENAI_ENDPOINT");
        deployment ??= GetEnvOrSkip("AZURE_OPENAI_CHAT_DEPLOYMENT");

        var connectionDict = new Dictionary<string, object?>
        {
            ["kind"] = "foundry",
            ["endpoint"] = endpoint,
        };

        var modelDict = new Dictionary<string, object?>
        {
            ["id"] = deployment,
            ["provider"] = "foundry",
            ["apiType"] = apiType,
            ["connection"] = connectionDict,
        };

        var data = new Dictionary<string, object?>
        {
            ["name"] = "integration-test-entra",
            ["model"] = modelDict,
        };

        var agent = Core.Prompty.Load(data, new LoadContext());

        if (options is not null && agent.Model is not null)
            agent.Model.Options = options;

        return agent;
    }

    [SkippableFact]
    public async Task Foundry_EntraId_TokenAcquisition()
    {
        Skip.If(!HasAzureEndpoint, "AZURE_OPENAI_ENDPOINT not set.");

        var cred = new DefaultAzureCredential();
        try
        {
            var token = await cred.GetTokenAsync(
                new Azure.Core.TokenRequestContext(["https://cognitiveservices.azure.com/.default"]),
                default);

            Assert.False(string.IsNullOrEmpty(token.Token), "Token should not be empty");
            Assert.True(token.ExpiresOn > DateTimeOffset.UtcNow, "Token should not be expired");
        }
        catch (AuthenticationFailedException ex)
        {
            Skip.If(true, $"DefaultAzureCredential failed — run `az login` first. ({ex.Message})");
        }
    }

    [SkippableFact]
    public async Task Foundry_EntraId_ChatCompletion()
    {
        Skip.If(!HasAzureEndpoint, "AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_CHAT_DEPLOYMENT not set.");

        var agent = MakeEntraIdAgent(options: LowTempOptions());
        var executor = new FoundryExecutor();
        var processor = new FoundryProcessor();

        try
        {
            var response = await executor.ExecuteAsync(agent, HelloMessages());
            var result = await processor.ProcessAsync(agent, response);

            Assert.IsType<string>(result);
            Assert.NotEmpty((string)result);
        }
        catch (AuthenticationFailedException ex)
        {
            Skip.If(true, $"Azure Entra ID credentials not available — run `az login` first. ({ex.Message})");
        }
        catch (ClientResultException ex) when (ex.Status is 401 or 403)
        {
            Skip.If(true, $"Azure Entra ID authorization failed (HTTP {ex.Status}) — ensure your identity has 'Cognitive Services OpenAI User' role on the resource.");
        }
    }

    [SkippableFact]
    public async Task Foundry_EntraId_ChatCompletion_Async()
    {
        Skip.If(!HasAzureEndpoint, "AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_CHAT_DEPLOYMENT not set.");

        var agent = MakeEntraIdAgent(options: LowTempOptions());
        var executor = new FoundryExecutor();
        var processor = new FoundryProcessor();

        try
        {
            var response = await executor.ExecuteAsync(agent, HelloMessages());
            var result = await processor.ProcessAsync(agent, response);

            Assert.IsType<string>(result);
            Assert.NotEmpty((string)result);
        }
        catch (AuthenticationFailedException ex)
        {
            Skip.If(true, $"Azure Entra ID credentials not available — run `az login` first. ({ex.Message})");
        }
        catch (ClientResultException ex) when (ex.Status is 401 or 403)
        {
            Skip.If(true, $"Azure Entra ID authorization failed (HTTP {ex.Status}) — ensure your identity has 'Cognitive Services OpenAI User' role on the resource.");
        }
    }
}

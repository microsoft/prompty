// Copyright (c) Microsoft. All rights reserved.

using System.ClientModel;
using Prompty.Core;
using Prompty.OpenAI;
using Prompty.Foundry;
using Prompty.Anthropic;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — error handling edge cases with real (or intentionally bad) API endpoints.
/// These tests use fake credentials intentionally and should NOT skip on missing env vars.
/// </summary>
[Trait("Category", "Integration")]
public class ErrorHandlingTests : IntegrationTestBase
{
    private static void RegisterProviders()
    {
        if (!InvokerRegistry.HasExecutor("openai"))
            InvokerRegistry.RegisterExecutor("openai", new OpenAIExecutor());
        if (!InvokerRegistry.HasProcessor("openai"))
            InvokerRegistry.RegisterProcessor("openai", new OpenAIProcessor());
        if (!InvokerRegistry.HasExecutor("foundry"))
            InvokerRegistry.RegisterExecutor("foundry", new FoundryExecutor());
        if (!InvokerRegistry.HasProcessor("foundry"))
            InvokerRegistry.RegisterProcessor("foundry", new FoundryProcessor());
        if (!InvokerRegistry.HasExecutor("anthropic"))
            InvokerRegistry.RegisterExecutor("anthropic", new AnthropicExecutor());
        if (!InvokerRegistry.HasProcessor("anthropic"))
            InvokerRegistry.RegisterProcessor("anthropic", new AnthropicProcessor());
    }

    /// <summary>
    /// Creates an agent with intentionally bad credentials, bypassing the usual
    /// MakeOpenAIAgent/MakeFoundryAgent/MakeAnthropicAgent helpers that skip on missing env vars.
    /// </summary>
    private static Core.Prompty MakeBadAgent(
        string provider,
        string? apiKey = null,
        string? endpoint = null,
        string? model = null)
    {
        var connectionDict = new Dictionary<string, object?>
        {
            ["kind"] = "key",
            ["apiKey"] = apiKey ?? "invalid-key",
        };
        if (endpoint is not null)
            connectionDict["endpoint"] = endpoint;

        var data = new Dictionary<string, object?>
        {
            ["name"] = "error-test",
            ["model"] = new Dictionary<string, object?>
            {
                ["id"] = model ?? "gpt-4o-mini",
                ["provider"] = provider,
                ["apiType"] = "chat",
                ["connection"] = connectionDict,
            },
        };
        return Core.Prompty.Load(data, new LoadContext());
    }

    // -----------------------------------------------------------------------
    // OpenAI — Invalid API Key
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_InvalidApiKey_ThrowsException()
    {
        RegisterProviders();

        var agent = MakeBadAgent("openai", apiKey: "sk-invalid-key-12345");
        var messages = HelloMessages();

        var ex = await Assert.ThrowsAsync<ClientResultException>(
            () => Pipeline.ExecuteAsync(agent, messages));

        // OpenAI returns 401 Unauthorized for invalid API keys
        Assert.True(
            ex.Status == 401 ||
            ex.Message.Contains("auth", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("unauthorized", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("invalid", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("Incorrect API key", StringComparison.OrdinalIgnoreCase),
            $"Expected auth/unauthorized error, got status {ex.Status}: {ex.Message}");
    }

    // -----------------------------------------------------------------------
    // OpenAI — Invalid Model
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_InvalidModel_ThrowsException()
    {
        Skip.If(!HasOpenAI, "OPENAI_API_KEY is not set — required for invalid model test.");

        RegisterProviders();

        var agent = MakeBadAgent(
            "openai",
            apiKey: OpenAIApiKey,
            model: "gpt-nonexistent-model-xyz");
        var messages = HelloMessages();

        var ex = await Assert.ThrowsAsync<ClientResultException>(
            () => Pipeline.ExecuteAsync(agent, messages));

        // OpenAI returns 404 for non-existent models, or 401 if key is wrong/expired
        Assert.True(
            ex.Status == 404 || ex.Status == 401 ||
            ex.Message.Contains("model", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("not found", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("does not exist", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("invalid", StringComparison.OrdinalIgnoreCase),
            $"Expected model-not-found or auth error, got status {ex.Status}: {ex.Message}");
    }

    // -----------------------------------------------------------------------
    // Foundry (Azure OpenAI) — Invalid Endpoint
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Foundry_InvalidEndpoint_ThrowsException()
    {
        RegisterProviders();

        var agent = MakeBadAgent(
            "foundry",
            apiKey: "fake-azure-key-12345",
            endpoint: "https://nonexistent-resource-prompty-test.openai.azure.com/",
            model: "gpt-4o-mini");
        var messages = HelloMessages();

        // DNS resolution or connection failure — the OpenAI SDK's retry policy
        // wraps failures in AggregateException after exhausting retries
        var ex = await Assert.ThrowsAnyAsync<Exception>(
            () => Pipeline.ExecuteAsync(agent, messages));

        Assert.True(
            ex is HttpRequestException ||
            ex is ClientResultException ||
            ex is AggregateException ||
            ex.InnerException is HttpRequestException,
            $"Expected connection/DNS error, got {ex.GetType().Name}: {ex.Message}");
    }

    // -----------------------------------------------------------------------
    // Anthropic — Invalid API Key
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Anthropic_InvalidApiKey_ThrowsException()
    {
        RegisterProviders();

        var agent = MakeBadAgent("anthropic", apiKey: "sk-ant-invalid-key-12345");
        var messages = HelloMessages();

        // Anthropic uses raw HttpClient, so EnsureSuccessStatusCode throws HttpRequestException
        var ex = await Assert.ThrowsAsync<HttpRequestException>(
            () => Pipeline.ExecuteAsync(agent, messages));

        Assert.True(
            ex.StatusCode == System.Net.HttpStatusCode.Unauthorized ||
            ex.Message.Contains("401", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("auth", StringComparison.OrdinalIgnoreCase) ||
            ex.Message.Contains("Unauthorized", StringComparison.OrdinalIgnoreCase),
            $"Expected auth/unauthorized error, got: {ex.Message}");
    }

    // -----------------------------------------------------------------------
    // OpenAI — Empty Messages
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_EmptyMessages_ThrowsException()
    {
        Skip.If(!HasOpenAI, "OPENAI_API_KEY is not set — required for empty messages test.");

        RegisterProviders();

        var agent = MakeOpenAIAgent(options: LowTempOptions());
        var emptyMessages = new List<Message>();

        // Empty messages should cause an error — either locally or a 400 from the API
        var ex = await Assert.ThrowsAnyAsync<Exception>(
            () => Pipeline.ExecuteAsync(agent, emptyMessages));

        Assert.True(
            ex is ClientResultException ||
            ex is ArgumentException ||
            ex is InvalidOperationException,
            $"Expected a validation or API error for empty messages, got {ex.GetType().Name}: {ex.Message}");
    }
}

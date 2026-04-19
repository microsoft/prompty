// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;
using Prompty.Foundry;
using Prompty.Anthropic;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — chat completions against real OpenAI, Azure/Foundry, and Anthropic endpoints.
/// </summary>
[Trait("Category", "Integration")]
public class ChatTests : IntegrationTestBase
{
    // -----------------------------------------------------------------------
    // OpenAI
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_BasicChat()
    {
        var agent = MakeOpenAIAgent(options: LowTempOptions());
        var executor = new OpenAIExecutor();
        var processor = new OpenAIProcessor();

        var response = await executor.ExecuteAsync(agent, HelloMessages());
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<string>(result);
        Assert.NotEmpty((string)result);
    }

    [SkippableFact]
    public async Task OpenAI_ChatWithTemperature()
    {
        var options = new ModelOptions { Temperature = 1.0f, MaxOutputTokens = 50 };
        var agent = MakeOpenAIAgent(options: options);
        var executor = new OpenAIExecutor();
        var processor = new OpenAIProcessor();

        var response = await executor.ExecuteAsync(agent, HelloMessages());
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<string>(result);
    }

    [SkippableFact]
    public async Task OpenAI_LowTemp_Deterministic()
    {
        var agent = MakeOpenAIAgent(options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 20, Seed = 42 });
        var executor = new OpenAIExecutor();
        var processor = new OpenAIProcessor();

        // Run twice with same seed + temp=0 — should get same-ish result
        var response1 = await executor.ExecuteAsync(agent, HelloMessages());
        var result1 = (string)await processor.ProcessAsync(agent, response1);

        var response2 = await executor.ExecuteAsync(agent, HelloMessages());
        var result2 = (string)await processor.ProcessAsync(agent, response2);

        Assert.NotEmpty(result1);
        Assert.NotEmpty(result2);
        // With temp=0 and seed, results should be identical or very similar
        Assert.Equal(result1, result2);
    }

    // -----------------------------------------------------------------------
    // Azure / Foundry
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Foundry_BasicChat()
    {
        var agent = MakeFoundryAgent(options: LowTempOptions());
        var executor = new FoundryExecutor();
        var processor = new FoundryProcessor();

        var response = await executor.ExecuteAsync(agent, HelloMessages());
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<string>(result);
        Assert.NotEmpty((string)result);
    }

    [SkippableFact]
    public async Task Foundry_ChatWithTemperature()
    {
        var options = new ModelOptions { Temperature = 1.0f, MaxOutputTokens = 50 };
        var agent = MakeFoundryAgent(options: options);
        var executor = new FoundryExecutor();
        var processor = new FoundryProcessor();

        var response = await executor.ExecuteAsync(agent, HelloMessages());
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<string>(result);
    }

    // -----------------------------------------------------------------------
    // Anthropic
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Anthropic_BasicChat()
    {
        var agent = MakeAnthropicAgent(options: LowTempOptions(100));
        var executor = new AnthropicExecutor();
        var processor = new AnthropicProcessor();

        var response = await executor.ExecuteAsync(agent, HelloMessages());
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<string>(result);
        Assert.NotEmpty((string)result);
    }

    [SkippableFact]
    public async Task Anthropic_ChatWithTemperature()
    {
        var options = new ModelOptions { Temperature = 1.0f, MaxOutputTokens = 100 };
        var agent = MakeAnthropicAgent(options: options);
        var executor = new AnthropicExecutor();
        var processor = new AnthropicProcessor();

        var response = await executor.ExecuteAsync(agent, HelloMessages());
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<string>(result);
    }
}

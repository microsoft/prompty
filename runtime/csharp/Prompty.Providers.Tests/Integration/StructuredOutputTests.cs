// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;
using Prompty.Foundry;
using Prompty.Anthropic;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — structured output (outputSchema → response_format) against real endpoints.
/// </summary>
[Trait("Category", "Integration")]
public class StructuredOutputTests : IntegrationTestBase
{
    // -----------------------------------------------------------------------
    // OpenAI
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_StructuredOutput()
    {
        var agent = MakeOpenAIAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 200 },
            outputs: CityOutputSchema());
        var executor = new OpenAIExecutor();
        var processor = new OpenAIProcessor();

        var response = await executor.ExecuteAsync(agent, StructuredMessages());
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<StructuredResult>(result);
        var sr = (StructuredResult)result;
        Assert.True(sr.ContainsKey("city"));
        Assert.True(sr.ContainsKey("population"));
        Assert.True(sr.ContainsKey("country"));
        Assert.IsType<string>(sr["city"]);
    }

    // -----------------------------------------------------------------------
    // Azure / Foundry
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Foundry_StructuredOutput()
    {
        var agent = MakeFoundryAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 200 },
            outputs: CityOutputSchema());
        var executor = new FoundryExecutor();
        var processor = new FoundryProcessor();

        var response = await executor.ExecuteAsync(agent, StructuredMessages());
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<StructuredResult>(result);
        var sr = (StructuredResult)result;
        Assert.True(sr.ContainsKey("city"));
        Assert.True(sr.ContainsKey("population"));
        Assert.True(sr.ContainsKey("country"));
    }

    // -----------------------------------------------------------------------
    // Anthropic
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Anthropic_StructuredOutput()
    {
        var agent = MakeAnthropicAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 200 },
            outputs: CityOutputSchema());
        var executor = new AnthropicExecutor();
        var processor = new AnthropicProcessor();

        var response = await executor.ExecuteAsync(agent, StructuredMessages());
        var result = await processor.ProcessAsync(agent, response);

        Assert.IsType<StructuredResult>(result);
        var sr = (StructuredResult)result;
        Assert.True(sr.ContainsKey("city"));
        Assert.True(sr.ContainsKey("population"));
        Assert.True(sr.ContainsKey("country"));
    }
}

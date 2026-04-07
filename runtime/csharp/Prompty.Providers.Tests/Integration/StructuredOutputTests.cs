// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
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

        Assert.IsType<JsonElement>(result);
        var json = (JsonElement)result;
        Assert.True(json.TryGetProperty("city", out var city));
        Assert.Equal(JsonValueKind.String, city.ValueKind);
        Assert.True(json.TryGetProperty("population", out var population));
        Assert.Equal(JsonValueKind.Number, population.ValueKind);
        Assert.True(json.TryGetProperty("country", out var country));
        Assert.Equal(JsonValueKind.String, country.ValueKind);
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

        Assert.IsType<JsonElement>(result);
        var json = (JsonElement)result;
        Assert.True(json.TryGetProperty("city", out _));
        Assert.True(json.TryGetProperty("population", out _));
        Assert.True(json.TryGetProperty("country", out _));
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

        Assert.IsType<JsonElement>(result);
        var json = (JsonElement)result;
        Assert.True(json.TryGetProperty("city", out _));
        Assert.True(json.TryGetProperty("population", out _));
        Assert.True(json.TryGetProperty("country", out _));
    }
}

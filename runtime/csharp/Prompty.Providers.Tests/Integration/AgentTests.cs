// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;
using Prompty.Foundry;
using Prompty.Anthropic;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — agent loop with tool calling against real endpoints.
/// </summary>
[Trait("Category", "Integration")]
public class AgentTests : IntegrationTestBase
{
    private static void RegisterProviders()
    {
        // Register all providers needed for the agent loop pipeline
        if (!InvokerRegistry.HasRenderer("jinja2"))
            InvokerRegistry.RegisterRenderer("jinja2", new Jinja2Renderer());
        if (!InvokerRegistry.HasParser("prompty"))
            InvokerRegistry.RegisterParser("prompty", new PromptyChatParser());
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

    // -----------------------------------------------------------------------
    // OpenAI
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_AgentToolCallLoop()
    {
        RegisterProviders();

        var agent = MakeOpenAIAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 200 },
            tools: [WeatherTool()]);
        agent.Instructions = "system:\nYou are a helpful assistant. Use tools when needed. Be brief.\nuser:\nWhat is the weather in Seattle?";

        var toolFunctions = new Dictionary<string, Func<string, Task<ToolResult>>>
        {
            ["get_weather"] = GetWeatherAsync,
        };

        var result = await Pipeline.TurnAsync(agent, tools: toolFunctions);

        Assert.IsType<string>(result);
        var text = (string)result;
        Assert.True(
            text.Contains("72", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("sunny", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Seattle", StringComparison.OrdinalIgnoreCase),
            $"Expected weather info in response, got: {text}");
    }

    // -----------------------------------------------------------------------
    // Azure / Foundry
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Foundry_AgentToolCallLoop()
    {
        RegisterProviders();

        var agent = MakeFoundryAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 200 },
            tools: [WeatherTool()]);
        agent.Instructions = "system:\nYou are a helpful assistant. Use tools when needed. Be brief.\nuser:\nWhat is the weather in Seattle?";

        var toolFunctions = new Dictionary<string, Func<string, Task<ToolResult>>>
        {
            ["get_weather"] = GetWeatherAsync,
        };

        var result = await Pipeline.TurnAsync(agent, tools: toolFunctions);

        Assert.IsType<string>(result);
        var text = (string)result;
        Assert.True(
            text.Contains("72", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("sunny", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Seattle", StringComparison.OrdinalIgnoreCase),
            $"Expected weather info in response, got: {text}");
    }

    // -----------------------------------------------------------------------
    // Anthropic
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Anthropic_AgentToolCallLoop()
    {
        RegisterProviders();

        var agent = MakeAnthropicAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 200 },
            tools: [WeatherTool()]);
        agent.Instructions = "system:\nYou are a helpful assistant. Use tools when needed. Be brief.\nuser:\nWhat is the weather in Seattle?";

        var toolFunctions = new Dictionary<string, Func<string, Task<ToolResult>>>
        {
            ["get_weather"] = GetWeatherAsync,
        };

        var result = await Pipeline.TurnAsync(agent, tools: toolFunctions);

        Assert.IsType<string>(result);
        var text = (string)result;
        Assert.True(
            text.Contains("72", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("sunny", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Seattle", StringComparison.OrdinalIgnoreCase),
            $"Expected weather info in response, got: {text}");
    }
}


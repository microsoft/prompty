// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;
using Prompty.Foundry;
using Prompty.Anthropic;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — streaming agent loop (tool calling with streaming responses)
/// against real endpoints. Combines streaming mode with the agent tool-call loop.
/// </summary>
[Trait("Category", "Integration")]
public class StreamingAgentTests : IntegrationTestBase
{
    private static void RegisterProviders()
    {
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

    private static Dictionary<string, Func<string, Task<string>>> WeatherToolFunctions() =>
        new() { ["get_weather"] = GetWeatherAsync };

    private static Dictionary<string, object> StreamingMetadata() =>
        new() { ["stream"] = true };

    // -----------------------------------------------------------------------
    // OpenAI
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_StreamingAgentToolCallLoop()
    {
        RegisterProviders();

        var agent = MakeOpenAIAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 200 },
            tools: [WeatherTool()],
            metadata: StreamingMetadata());
        agent.Instructions = "system:\nYou are a helpful assistant. Use tools when asked about weather. Be brief.\nuser:\nWhat is the weather in Seattle?";

        var result = await Pipeline.InvokeAgentAsync(agent, tools: WeatherToolFunctions());

        Assert.IsType<string>(result);
        var text = (string)result;
        Assert.True(
            text.Contains("72", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("sunny", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Seattle", StringComparison.OrdinalIgnoreCase),
            $"Expected weather info in response, got: {text}");
    }

    [SkippableFact]
    public async Task OpenAI_StreamingAgentMultipleToolCalls()
    {
        RegisterProviders();

        var agent = MakeOpenAIAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 300 },
            tools: [WeatherTool()],
            metadata: StreamingMetadata());
        agent.Instructions = "system:\nYou are a helpful assistant. Use tools when asked about weather. Call the tool for each city separately.\nuser:\nWhat is the weather in Seattle and Tokyo?";

        var result = await Pipeline.InvokeAgentAsync(agent, tools: WeatherToolFunctions());

        Assert.IsType<string>(result);
        var text = (string)result;
        Assert.True(
            text.Contains("Seattle", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Tokyo", StringComparison.OrdinalIgnoreCase),
            $"Expected city names in response, got: {text}");
        Assert.Contains("72", text, StringComparison.OrdinalIgnoreCase);
    }

    // -----------------------------------------------------------------------
    // Azure / Foundry
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Foundry_StreamingAgentToolCallLoop()
    {
        RegisterProviders();

        var agent = MakeFoundryAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 200 },
            tools: [WeatherTool()],
            metadata: StreamingMetadata());
        agent.Instructions = "system:\nYou are a helpful assistant. Use tools when asked about weather. Be brief.\nuser:\nWhat is the weather in Seattle?";

        var result = await Pipeline.InvokeAgentAsync(agent, tools: WeatherToolFunctions());

        Assert.IsType<string>(result);
        var text = (string)result;
        Assert.True(
            text.Contains("72", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("sunny", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Seattle", StringComparison.OrdinalIgnoreCase),
            $"Expected weather info in response, got: {text}");
    }

    [SkippableFact]
    public async Task Foundry_StreamingAgentMultipleToolCalls()
    {
        RegisterProviders();

        var agent = MakeFoundryAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 300 },
            tools: [WeatherTool()],
            metadata: StreamingMetadata());
        agent.Instructions = "system:\nYou are a helpful assistant. Use tools when asked about weather. Call the tool for each city separately.\nuser:\nWhat is the weather in Seattle and Tokyo?";

        var result = await Pipeline.InvokeAgentAsync(agent, tools: WeatherToolFunctions());

        Assert.IsType<string>(result);
        var text = (string)result;
        Assert.True(
            text.Contains("Seattle", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Tokyo", StringComparison.OrdinalIgnoreCase),
            $"Expected city names in response, got: {text}");
        Assert.Contains("72", text, StringComparison.OrdinalIgnoreCase);
    }

    // -----------------------------------------------------------------------
    // Anthropic
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Anthropic_StreamingAgentToolCallLoop()
    {
        RegisterProviders();

        var agent = MakeAnthropicAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 200 },
            tools: [WeatherTool()],
            metadata: StreamingMetadata());
        agent.Instructions = "system:\nYou are a helpful assistant. Use tools when asked about weather. Be brief.\nuser:\nWhat is the weather in Seattle?";

        var result = await Pipeline.InvokeAgentAsync(agent, tools: WeatherToolFunctions());

        Assert.IsType<string>(result);
        var text = (string)result;
        Assert.True(
            text.Contains("72", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("sunny", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Seattle", StringComparison.OrdinalIgnoreCase),
            $"Expected weather info in response, got: {text}");
    }

    [SkippableFact]
    public async Task Anthropic_StreamingAgentMultipleToolCalls()
    {
        RegisterProviders();

        var agent = MakeAnthropicAgent(
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 300 },
            tools: [WeatherTool()],
            metadata: StreamingMetadata());
        agent.Instructions = "system:\nYou are a helpful assistant. Use tools when asked about weather. Call the tool for each city separately.\nuser:\nWhat is the weather in Seattle and Tokyo?";

        var result = await Pipeline.InvokeAgentAsync(agent, tools: WeatherToolFunctions());

        Assert.IsType<string>(result);
        var text = (string)result;
        Assert.True(
            text.Contains("Seattle", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Tokyo", StringComparison.OrdinalIgnoreCase),
            $"Expected city names in response, got: {text}");
        Assert.Contains("72", text, StringComparison.OrdinalIgnoreCase);
    }
}

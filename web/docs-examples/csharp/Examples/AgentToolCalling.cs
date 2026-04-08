// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;

namespace DocsExamples.Examples;

/// <summary>
/// Agent with tool calling — define tools, load agent prompty, invoke with tools.
/// </summary>
public static class AgentToolCalling
{
    /// <summary>
    /// Runs an agent loop that can call registered tools until the LLM
    /// returns a final response or max iterations is reached.
    /// </summary>
    public static async Task<object> RunAsync(
        string promptyPath,
        Dictionary<string, Func<string, Task<string>>> tools,
        Dictionary<string, object?>? inputs = null,
        int maxIterations = 10)
    {
        // One-time setup
        new PromptyBuilder()
            .AddOpenAI();

        // Register built-in tool handlers (function, mcp, etc.)
        ToolDispatch.RegisterBuiltins();

        // Load the agent
        var agent = PromptyLoader.Load(promptyPath);

        // Run the agent loop with tool dispatch
        var result = await Pipeline.InvokeAgentAsync(
            agent,
            inputs,
            tools: tools,
            maxIterations: maxIterations);

        return result;
    }

    /// <summary>
    /// Runs an agent using the [Tool] attribute for automatic tool discovery.
    /// </summary>
    public static async Task<object> RunWithToolAttributeAsync(
        string promptyPath,
        object toolInstance,
        Dictionary<string, object?>? inputs = null,
        int maxIterations = 10)
    {
        // One-time setup
        new PromptyBuilder()
            .AddOpenAI();
        ToolDispatch.RegisterBuiltins();

        // Load and bind tools
        var agent = PromptyLoader.Load(promptyPath);
        var tools = ToolAttribute.BindTools(agent, toolInstance);

        var result = await Pipeline.InvokeAgentAsync(
            agent,
            inputs,
            tools: tools,
            maxIterations: maxIterations);

        return result;
    }
}

/// <summary>
/// Example tool class using the [Tool] attribute for auto-discovery.
/// </summary>
public class WeatherTools
{
    [ToolAttribute(Name = "get_weather", Description = "Get the current weather for a city")]
    public string GetWeather(string city)
    {
        return $"72°F and sunny in {city}";
    }
}


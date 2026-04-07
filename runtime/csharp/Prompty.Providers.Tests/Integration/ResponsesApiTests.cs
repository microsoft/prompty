// Copyright (c) Microsoft. All rights reserved.

#pragma warning disable OPENAI001 // Responses API is in preview

using Prompty.Core;
using Prompty.OpenAI;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — OpenAI Responses API (POST /v1/responses).
/// The Responses API is OpenAI-only and not supported by Foundry/Azure or Anthropic.
/// </summary>
[Trait("Category", "Integration")]
public class ResponsesApiTests : IntegrationTestBase
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
    }

    // -----------------------------------------------------------------------
    // Basic chat via Responses API
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_ResponsesApi_BasicChat()
    {
        var agent = MakeOpenAIAgent(
            apiType: "responses",
            options: new ModelOptions { Temperature = 0.5f, MaxOutputTokens = 200 });

        var messages = new List<Message>
        {
            new() { Role = Roles.System, Parts = [new TextPart { Value = "You are a helpful assistant. Reply in one short sentence." }] },
            new() { Role = Roles.User, Parts = [new TextPart { Value = "Say hello in exactly 3 words." }] },
        };

        var executor = new OpenAIExecutor();
        var processor = new OpenAIProcessor();

        var response = await executor.ExecuteAsync(agent, messages);
        var result = await processor.ProcessAsync(agent, response);

        Assert.NotNull(result);
        var text = result?.ToString();
        Assert.False(string.IsNullOrWhiteSpace(text), "Expected non-empty text from Responses API.");
    }

    // -----------------------------------------------------------------------
    // Streaming via Responses API
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_ResponsesApi_Streaming()
    {
        var agent = MakeOpenAIAgent(
            apiType: "responses",
            options: new ModelOptions { Temperature = 0.5f, MaxOutputTokens = 200 },
            metadata: new Dictionary<string, object> { ["stream"] = true });

        var messages = new List<Message>
        {
            new() { Role = Roles.System, Parts = [new TextPart { Value = "You are a helpful assistant. Reply in one short sentence." }] },
            new() { Role = Roles.User, Parts = [new TextPart { Value = "Say hello in exactly 3 words." }] },
        };

        var executor = new OpenAIExecutor();
        var processor = new OpenAIProcessor();

        var response = await executor.ExecuteAsync(agent, messages);
        Assert.IsType<PromptyStream>(response);

        var result = await processor.ProcessAsync(agent, response);

        // Streaming processor returns a ProcessedStream or similar async enumerable;
        // drain it and verify we got content.
        if (result is IAsyncEnumerable<string> asyncStream)
        {
            var chunks = new List<string>();
            await foreach (var chunk in asyncStream)
            {
                chunks.Add(chunk);
            }
            Assert.NotEmpty(chunks);
            var fullText = string.Join("", chunks);
            Assert.False(string.IsNullOrWhiteSpace(fullText), "Expected non-empty streamed text from Responses API.");
        }
        else
        {
            // If the processor returned the accumulated result directly, verify it's non-empty
            var text = result?.ToString();
            Assert.False(string.IsNullOrWhiteSpace(text), "Expected non-empty result from Responses API streaming.");
        }
    }

    // -----------------------------------------------------------------------
    // Tool calling via Responses API (agent loop)
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_ResponsesApi_WithTools()
    {
        RegisterProviders();

        var agent = MakeOpenAIAgent(
            apiType: "responses",
            options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 200 },
            tools: [WeatherTool()]);
        agent.Instructions = "system:\nYou are a helpful assistant. Use tools when needed. Be brief.\nuser:\nWhat is the weather in Seattle?";

        var toolFunctions = new Dictionary<string, Func<string, Task<string>>>
        {
            ["get_weather"] = GetWeatherAsync,
        };

        var result = await Pipeline.InvokeAgentAsync(agent, tools: toolFunctions);

        Assert.IsType<string>(result);
        var text = (string)result;
        Assert.True(
            text.Contains("72", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("sunny", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("Seattle", StringComparison.OrdinalIgnoreCase),
            $"Expected weather info in response, got: {text}");
    }
}

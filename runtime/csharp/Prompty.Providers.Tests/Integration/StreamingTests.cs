// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.OpenAI;
using Prompty.Foundry;
using Prompty.Anthropic;

namespace Prompty.Providers.Tests.Integration;

/// <summary>
/// Integration tests — streaming chat completions against real endpoints.
/// </summary>
[Trait("Category", "Integration")]
public class StreamingTests : IntegrationTestBase
{
    private static void EnableStreaming(Core.Prompty agent)
    {
        agent.Metadata ??= new Dictionary<string, object>();
        agent.Metadata["stream"] = true;
    }

    // -----------------------------------------------------------------------
    // OpenAI
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task OpenAI_StreamingChat()
    {
        var agent = MakeOpenAIAgent(options: LowTempOptions());
        EnableStreaming(agent);

        var executor = new OpenAIExecutor();
        var processor = new OpenAIProcessor();

        var response = await executor.ExecuteAsync(agent, ChatMessages());
        Assert.IsType<PromptyStream>(response);

        var result = await processor.ProcessAsync(agent, response);
        Assert.IsAssignableFrom<IAsyncEnumerable<string>>(result);

        var chunks = new List<string>();
        await foreach (var chunk in (IAsyncEnumerable<string>)result)
        {
            chunks.Add(chunk);
        }

        Assert.NotEmpty(chunks);
        var fullText = string.Join("", chunks);
        Assert.Contains("hello", fullText, StringComparison.OrdinalIgnoreCase);
    }

    // -----------------------------------------------------------------------
    // Azure / Foundry
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Foundry_StreamingChat()
    {
        var agent = MakeFoundryAgent(options: LowTempOptions());
        EnableStreaming(agent);

        var executor = new FoundryExecutor();
        var processor = new FoundryProcessor();

        var response = await executor.ExecuteAsync(agent, ChatMessages());
        Assert.IsType<PromptyStream>(response);

        var result = await processor.ProcessAsync(agent, response);
        Assert.IsAssignableFrom<IAsyncEnumerable<string>>(result);

        var chunks = new List<string>();
        await foreach (var chunk in (IAsyncEnumerable<string>)result)
        {
            chunks.Add(chunk);
        }

        Assert.NotEmpty(chunks);
        var fullText = string.Join("", chunks);
        Assert.Contains("hello", fullText, StringComparison.OrdinalIgnoreCase);
    }

    // -----------------------------------------------------------------------
    // Anthropic
    // -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Anthropic_StreamingChat()
    {
        var agent = MakeAnthropicAgent(options: new ModelOptions { Temperature = 0f, MaxOutputTokens = 100 });
        EnableStreaming(agent);

        var executor = new AnthropicExecutor();
        var processor = new AnthropicProcessor();

        var response = await executor.ExecuteAsync(agent, ChatMessages());
        Assert.IsType<PromptyStream>(response);

        var result = await processor.ProcessAsync(agent, response);
        Assert.IsAssignableFrom<IAsyncEnumerable<string>>(result);

        var chunks = new List<string>();
        await foreach (var chunk in (IAsyncEnumerable<string>)result)
        {
            chunks.Add(chunk);
        }

        Assert.NotEmpty(chunks);
        var fullText = string.Join("", chunks);
        Assert.Contains("hello", fullText, StringComparison.OrdinalIgnoreCase);
    }
}

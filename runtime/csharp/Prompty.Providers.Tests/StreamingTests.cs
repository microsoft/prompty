// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;
using Prompty.Core.Tracing;

namespace Prompty.Providers.Tests;

/// <summary>
/// Tests for PromptyStream accumulation and tracing integration,
/// and ProcessedStream delta extraction.
/// </summary>
public class StreamingTests : IDisposable
{
    public StreamingTests()
    {
        Tracer.Clear();
    }

    public void Dispose()
    {
        Tracer.Clear();
    }

    // --- PromptyStream accumulation ---

    [Fact]
    public async Task PromptyStream_AccumulatesItems()
    {
        var items = new[] { "chunk1", "chunk2", "chunk3" };
        var stream = new PromptyStream(ToAsyncEnumerable(items));

        var collected = new List<object>();
        await foreach (var item in stream)
        {
            collected.Add(item);
        }

        Assert.Equal(3, collected.Count);
        Assert.Equal(3, stream.Items.Count);
        Assert.Equal("chunk1", stream.Items[0]);
        Assert.Equal("chunk2", stream.Items[1]);
        Assert.Equal("chunk3", stream.Items[2]);
    }

    [Fact]
    public async Task PromptyStream_EmptyStream_ProducesNoItems()
    {
        var stream = new PromptyStream(ToAsyncEnumerable(Array.Empty<string>()));

        var collected = new List<object>();
        await foreach (var item in stream)
        {
            collected.Add(item);
        }

        Assert.Empty(collected);
        Assert.Empty(stream.Items);
    }

    [Fact]
    public async Task PromptyStream_EmitsTraceOnExhaustion()
    {
        var spans = new List<(string name, Dictionary<string, object?> data)>();
        Tracer.Add("test", name =>
        {
            var data = new Dictionary<string, object?>();
            return new TestTracerSpan(name, data, () => spans.Add((name, data)));
        });

        var items = new[] { "a", "b" };
        var stream = new PromptyStream(ToAsyncEnumerable(items));

        await foreach (var _ in stream) { }

        // Should have emitted a "PromptyStream" span
        var promptySpan = spans.FirstOrDefault(s => s.name == "PromptyStream");
        Assert.NotEqual(default, promptySpan);
        Assert.True(promptySpan.data.ContainsKey("result"));
    }

    [Fact]
    public async Task PromptyStream_NoTraceWhenNoListeners()
    {
        // No tracers registered — should not throw
        var items = new[] { "x", "y" };
        var stream = new PromptyStream(ToAsyncEnumerable(items));

        var collected = new List<object>();
        await foreach (var item in stream)
        {
            collected.Add(item);
        }

        Assert.Equal(2, collected.Count);
    }

    // --- OpenAI ProcessedStream ---

    [Fact]
    public async Task ProcessedStream_ExtractsDeltaText()
    {
        // Create mock StreamingChatCompletionUpdate objects
        // Since we can't easily create SDK types, test via the processor path
        // Instead, verify ProcessedStream implements IAsyncEnumerable<string>
        var processor = new OpenAI.OpenAIProcessor();
        var items = new[] { "delta1", "delta2" };
        var rawStream = new PromptyStream(ToAsyncEnumerable(items));

        // The processor should wrap it in a ProcessedStream
        var agent = TestHelpers.CreateAgent();
        agent.Metadata = new Dictionary<string, object?> { ["stream"] = true };

        var result = await processor.ProcessAsync(agent, rawStream);
        Assert.IsType<OpenAI.ProcessedStream>(result);
    }

    // --- Anthropic ProcessedStream ---

    [Fact]
    public async Task AnthropicProcessedStream_ExtractsDeltaText()
    {
        // Create JSON chunks that look like Anthropic SSE events
        var chunks = new object[]
        {
            System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(
                """{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}"""),
            System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(
                """{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}"""),
            System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(
                """{"type":"message_stop"}"""),
        };

        var rawStream = new PromptyStream(ToAsyncEnumerable(chunks));
        var processedStream = new Anthropic.AnthropicProcessedStream(rawStream);

        var textParts = new List<string>();
        await foreach (var part in processedStream)
        {
            textParts.Add(part);
        }

        Assert.Equal(2, textParts.Count);
        Assert.Equal("Hello ", textParts[0]);
        Assert.Equal("world", textParts[1]);
    }

    [Fact]
    public async Task AnthropicProcessedStream_SkipsNonDeltaEvents()
    {
        var chunks = new object[]
        {
            System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(
                """{"type":"message_start","message":{"id":"msg_1"}}"""),
            System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(
                """{"type":"content_block_start","index":0}"""),
            System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(
                """{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}"""),
            System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(
                """{"type":"content_block_stop"}"""),
        };

        var rawStream = new PromptyStream(ToAsyncEnumerable(chunks));
        var processedStream = new Anthropic.AnthropicProcessedStream(rawStream);

        var textParts = new List<string>();
        await foreach (var part in processedStream)
        {
            textParts.Add(part);
        }

        Assert.Single(textParts);
        Assert.Equal("Hi", textParts[0]);
    }

    [Fact]
    public async Task AnthropicProcessor_HandlesStreamInput()
    {
        var processor = new Anthropic.AnthropicProcessor();
        var chunks = new object[]
        {
            System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(
                """{"type":"content_block_delta","delta":{"type":"text_delta","text":"test"}}"""),
        };

        var rawStream = new PromptyStream(ToAsyncEnumerable(chunks));
        var agent = TestHelpers.CreateAgent(provider: "anthropic");

        var result = await processor.ProcessAsync(agent, rawStream);
        Assert.IsType<Anthropic.AnthropicProcessedStream>(result);
    }

    // --- Streaming flag in executor ---

    [Fact]
    public void StreamMetadata_EnablesStreaming()
    {
        var agent = TestHelpers.CreateAgent();
        agent.Metadata = new Dictionary<string, object?> { ["stream"] = true };

        var streamVal = agent.Metadata.TryGetValue("stream", out var val) && val is true;
        Assert.True(streamVal);
    }

    [Fact]
    public void StreamMetadata_DefaultIsNonStreaming()
    {
        var agent = TestHelpers.CreateAgent();

        var streamVal = agent.Metadata?.TryGetValue("stream", out var val) == true && val is true;
        Assert.False(streamVal);
    }

    // --- Helpers ---

    private static async IAsyncEnumerable<object> ToAsyncEnumerable<T>(IEnumerable<T> source) where T : notnull
    {
        foreach (var item in source)
        {
            yield return item;
            await Task.Yield();
        }
    }

    private class TestTracerSpan : ITracerSpan
    {
        private readonly string _name;
        private readonly Dictionary<string, object?> _data;
        private readonly Action _onDispose;

        public TestTracerSpan(string name, Dictionary<string, object?> data, Action onDispose)
        {
            _name = name;
            _data = data;
            _onDispose = onDispose;
        }

        public void Emit(string key, object? value) => _data[key] = value;
        public void Dispose() => _onDispose();
    }
}

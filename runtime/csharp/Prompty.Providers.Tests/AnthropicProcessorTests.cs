// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using Prompty.Anthropic;
using Prompty.Core;

namespace Prompty.Providers.Tests;

/// <summary>
/// Tests for the Anthropic processor which works with JsonElement responses.
/// </summary>
public class AnthropicProcessorTests
{
    private static JsonElement ParseJson(string json) =>
        JsonDocument.Parse(json).RootElement;

    [Fact]
    public async Task TextResponse_ExtractsText()
    {
        var json = ParseJson("""
        {
            "id": "msg_01",
            "type": "message",
            "role": "assistant",
            "stop_reason": "end_turn",
            "content": [
                { "type": "text", "text": "Hello, how can I help you?" }
            ]
        }
        """);

        var agent = TestHelpers.CreateAgent(provider: "anthropic");
        var processor = new AnthropicProcessor();

        var result = await processor.ProcessAsync(agent, json);

        Assert.Equal("Hello, how can I help you?", result);
    }

    [Fact]
    public async Task MultipleTextBlocks_ConcatenatesText()
    {
        var json = ParseJson("""
        {
            "id": "msg_02",
            "type": "message",
            "role": "assistant",
            "stop_reason": "end_turn",
            "content": [
                { "type": "text", "text": "First part. " },
                { "type": "text", "text": "Second part." }
            ]
        }
        """);

        var agent = TestHelpers.CreateAgent(provider: "anthropic");
        var processor = new AnthropicProcessor();

        var result = await processor.ProcessAsync(agent, json);

        Assert.Equal("First part. Second part.", result);
    }

    [Fact]
    public async Task ToolUseResponse_ExtractsToolCalls()
    {
        var json = ParseJson("""
        {
            "id": "msg_03",
            "type": "message",
            "role": "assistant",
            "stop_reason": "tool_use",
            "content": [
                {
                    "type": "tool_use",
                    "id": "toolu_01",
                    "name": "get_weather",
                    "input": { "city": "Seattle" }
                }
            ]
        }
        """);

        var agent = TestHelpers.CreateAgent(provider: "anthropic");
        var processor = new AnthropicProcessor();

        var result = await processor.ProcessAsync(agent, json);

        var toolCallResult = Assert.IsType<ToolCallResult>(result);
        Assert.Single(toolCallResult.ToolCalls);
        Assert.Equal("toolu_01", toolCallResult.ToolCalls[0].Id);
        Assert.Equal("get_weather", toolCallResult.ToolCalls[0].Name);
        Assert.Contains("Seattle", toolCallResult.ToolCalls[0].Arguments);
    }

    [Fact]
    public async Task ToolUseResponse_WithText_IncludesBoth()
    {
        var json = ParseJson("""
        {
            "id": "msg_04",
            "type": "message",
            "role": "assistant",
            "stop_reason": "tool_use",
            "content": [
                { "type": "text", "text": "Let me check the weather." },
                {
                    "type": "tool_use",
                    "id": "toolu_02",
                    "name": "get_weather",
                    "input": { "location": "NYC" }
                }
            ]
        }
        """);

        var agent = TestHelpers.CreateAgent(provider: "anthropic");
        var processor = new AnthropicProcessor();

        var result = await processor.ProcessAsync(agent, json);

        var toolCallResult = Assert.IsType<ToolCallResult>(result);
        Assert.Equal("Let me check the weather.", toolCallResult.Content);
        Assert.Single(toolCallResult.ToolCalls);
        Assert.Equal("get_weather", toolCallResult.ToolCalls[0].Name);
    }

    [Fact]
    public async Task MultipleToolUse_ExtractsAll()
    {
        var json = ParseJson("""
        {
            "id": "msg_05",
            "type": "message",
            "role": "assistant",
            "stop_reason": "tool_use",
            "content": [
                {
                    "type": "tool_use",
                    "id": "toolu_a",
                    "name": "get_weather",
                    "input": { "city": "Seattle" }
                },
                {
                    "type": "tool_use",
                    "id": "toolu_b",
                    "name": "get_time",
                    "input": { "timezone": "PST" }
                }
            ]
        }
        """);

        var agent = TestHelpers.CreateAgent(provider: "anthropic");
        var processor = new AnthropicProcessor();

        var result = await processor.ProcessAsync(agent, json);

        var toolCallResult = Assert.IsType<ToolCallResult>(result);
        Assert.Equal(2, toolCallResult.ToolCalls.Count);
        Assert.Equal("toolu_a", toolCallResult.ToolCalls[0].Id);
        Assert.Equal("toolu_b", toolCallResult.ToolCalls[1].Id);
    }

    [Fact]
    public async Task StructuredOutput_ParsesJson()
    {
        var json = ParseJson("""
        {
            "id": "msg_06",
            "type": "message",
            "role": "assistant",
            "stop_reason": "end_turn",
            "content": [
                { "type": "text", "text": "{\"answer\": \"42\", \"confidence\": 0.95}" }
            ]
        }
        """);

        var outputs = new List<Property>
        {
            new() { Name = "answer", Kind = "string" },
            new() { Name = "confidence", Kind = "float" },
        };
        var agent = TestHelpers.CreateAgent(provider: "anthropic", outputs: outputs);
        var processor = new AnthropicProcessor();

        var result = await processor.ProcessAsync(agent, json);

        var sr = Assert.IsType<StructuredResult>(result);
        Assert.Equal("42", sr["answer"]?.ToString());
    }

    [Fact]
    public async Task StructuredOutput_FallsBackToText()
    {
        var json = ParseJson("""
        {
            "id": "msg_07",
            "type": "message",
            "role": "assistant",
            "stop_reason": "end_turn",
            "content": [
                { "type": "text", "text": "This is not valid JSON" }
            ]
        }
        """);

        var outputs = new List<Property>
        {
            new() { Name = "answer", Kind = "string" },
        };
        var agent = TestHelpers.CreateAgent(provider: "anthropic", outputs: outputs);
        var processor = new AnthropicProcessor();

        var result = await processor.ProcessAsync(agent, json);

        Assert.Equal("This is not valid JSON", result);
    }

    [Fact]
    public async Task NonJsonElement_ReturnsAsIs()
    {
        var agent = TestHelpers.CreateAgent(provider: "anthropic");
        var processor = new AnthropicProcessor();
        var input = "just a string";

        var result = await processor.ProcessAsync(agent, input);

        Assert.Equal("just a string", result);
    }

    [Fact]
    public async Task EmptyContent_ReturnsEmptyString()
    {
        var json = ParseJson("""
        {
            "id": "msg_08",
            "type": "message",
            "role": "assistant",
            "stop_reason": "end_turn",
            "content": []
        }
        """);

        var agent = TestHelpers.CreateAgent(provider: "anthropic");
        var processor = new AnthropicProcessor();

        var result = await processor.ProcessAsync(agent, json);

        Assert.Equal("", result);
    }

    [Fact]
    public async Task MissingContent_ReturnsEmptyString()
    {
        var json = ParseJson("""
        {
            "id": "msg_09",
            "type": "message",
            "role": "assistant",
            "stop_reason": "end_turn"
        }
        """);

        var agent = TestHelpers.CreateAgent(provider: "anthropic");
        var processor = new AnthropicProcessor();

        var result = await processor.ProcessAsync(agent, json);

        Assert.Equal("", result);
    }

    [Fact]
    public void Processor_ImplementsIProcessor()
    {
        var processor = new AnthropicProcessor();
        Assert.IsAssignableFrom<IProcessor>(processor);
    }

    [Fact]
    public async Task ToolUseResponse_MissingId_DefaultsToEmpty()
    {
        var json = ParseJson("""
        {
            "id": "msg_10",
            "type": "message",
            "role": "assistant",
            "stop_reason": "tool_use",
            "content": [
                {
                    "type": "tool_use",
                    "name": "some_tool",
                    "input": {}
                }
            ]
        }
        """);

        var agent = TestHelpers.CreateAgent(provider: "anthropic");
        var processor = new AnthropicProcessor();

        var result = await processor.ProcessAsync(agent, json);

        var toolCallResult = Assert.IsType<ToolCallResult>(result);
        Assert.Single(toolCallResult.ToolCalls);
        Assert.Equal("", toolCallResult.ToolCalls[0].Id);
    }
}

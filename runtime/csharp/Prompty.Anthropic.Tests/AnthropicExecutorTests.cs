// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Anthropic.Tests;

/// <summary>
/// Tests for Anthropic executor connection validation and message formatting.
/// </summary>
public class AnthropicExecutorTests
{
    [Fact]
    public async Task ExecuteAsync_MissingApiKey_ThrowsInvalidOperationException()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Id = "claude-sonnet-4-20250514",
                Connection = new ApiKeyConnection { ApiKey = null! },
            },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Role.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public async Task ExecuteAsync_EmptyApiKey_ThrowsInvalidOperationException()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model
            {
                Id = "claude-sonnet-4-20250514",
                Connection = new ApiKeyConnection { ApiKey = "" },
            },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Role.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public async Task ExecuteAsync_NoConnection_ThrowsInvalidOperationException()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var agent = new Core.Prompty
        {
            Model = new Model { Id = "claude-sonnet-4-20250514" },
        };

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => executor.ExecuteAsync(agent, [new Message { Role = Role.User, Parts = [new TextPart { Value = "hi" }] }]));
    }

    [Fact]
    public void DefaultModel_IsClaude()
    {
        var agent = new Core.Prompty
        {
            Model = new Model { Id = null! },
        };

        Assert.Equal("claude-sonnet-4-20250514", agent.Model?.Id ?? "claude-sonnet-4-20250514");
    }

    [Fact]
    public void OutputSchemaToWire_WithOutputs_ReturnsOutputConfig()
    {
        var agent = TestHelpers.CreateAgent(
            provider: "anthropic",
            outputs:
            [
                new Property { Name = "name", Kind = "string" },
                new Property { Name = "age", Kind = "integer" },
            ]);

        var config = Anthropic.AnthropicExecutor.OutputSchemaToWire(agent);

        Assert.NotNull(config);
        Assert.True(config.ContainsKey("format"));
        var format = config["format"] as Dictionary<string, object?>;
        Assert.NotNull(format);
        Assert.Equal("json_schema", format["type"]);
        Assert.True(format.ContainsKey("schema"));
    }

    [Fact]
    public void OutputSchemaToWire_NoOutputs_ReturnsNull()
    {
        var agent = TestHelpers.CreateAgent(provider: "anthropic");

        var config = Anthropic.AnthropicExecutor.OutputSchemaToWire(agent);

        Assert.Null(config);
    }

    // -----------------------------------------------------------------------
    // FormatToolMessages — Anthropic batching
    // -----------------------------------------------------------------------

    [Fact]
    public void FormatToolMessages_BatchesToolResultsIntoSingleUserMessage()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var toolCalls = new List<ToolCall>
        {
            new() { Id = "call_1", Name = "get_weather", Arguments = """{"city":"Seattle"}""" },
            new() { Id = "call_2", Name = "get_time", Arguments = """{"tz":"PST"}""" },
        };
        var toolResults = new List<string> { "72°F", "3:00 PM" };

        var messages = executor.FormatToolMessages("raw", toolCalls, toolResults, "Let me check.");

        // Should be 2 messages: assistant + single user message (NOT 3)
        Assert.Equal(2, messages.Count);

        // Assistant message preserves text + tool_use content blocks
        Assert.Equal(Role.Assistant, messages[0].Role);
        Assert.Equal("Let me check.", messages[0].Text);
        var content = Assert.IsType<List<Dictionary<string, object?>>>(messages[0].Metadata["content"]);
        Assert.Equal(3, content.Count); // 1 text + 2 tool_use
        Assert.Equal("text", content[0]["type"]);
        Assert.Equal("tool_use", content[1]["type"]);
        Assert.Equal("tool_use", content[2]["type"]);

        // Single user message with batched tool_result blocks
        Assert.Equal(Role.User, messages[1].Role);
        var toolResultBlocks = Assert.IsType<List<Dictionary<string, object?>>>(messages[1].Metadata["tool_results"]);
        Assert.Equal(2, toolResultBlocks.Count);
        Assert.Equal("tool_result", toolResultBlocks[0]["type"]);
        Assert.Equal("call_1", toolResultBlocks[0]["tool_use_id"]);
        Assert.Equal("72°F", toolResultBlocks[0]["content"]);
        Assert.Equal("tool_result", toolResultBlocks[1]["type"]);
        Assert.Equal("call_2", toolResultBlocks[1]["tool_use_id"]);
        Assert.Equal("3:00 PM", toolResultBlocks[1]["content"]);
    }

    [Fact]
    public void FormatToolMessages_NoTextContent_OmitsTextBlock()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var toolCalls = new List<ToolCall>
        {
            new() { Id = "call_1", Name = "fn", Arguments = "{}" },
        };
        var toolResults = new List<string> { "result" };

        var messages = executor.FormatToolMessages("raw", toolCalls, toolResults);

        var content = Assert.IsType<List<Dictionary<string, object?>>>(messages[0].Metadata["content"]);
        Assert.Single(content); // Only tool_use, no text block
        Assert.Equal("tool_use", content[0]["type"]);
    }
}


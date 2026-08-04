// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
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
        using var rawResponse = JsonDocument.Parse(
            """
            {
              "content": [
                {"type":"text","text":"Let me check."},
                {"type":"tool_use","id":"call_1","name":"get_weather","input":{"city":"Seattle"}},
                {"type":"tool_use","id":"call_2","name":"get_time","input":{"tz":"PST"}}
              ]
            }
            """);

        var messages = executor.FormatToolMessages(rawResponse.RootElement, toolCalls, toolResults, "Let me check.");

        // Should be 2 messages: assistant + single user message (NOT 3)
        Assert.Equal(2, messages.Count);

        // Assistant message preserves text + tool_use content blocks
        Assert.Equal(Role.Assistant, messages[0].Role);
        Assert.Equal("Let me check.", messages[0].Text);
        var content = Assert.IsType<JsonElement>(messages[0].Metadata["content"]);
        Assert.Equal(3, content.GetArrayLength()); // 1 text + 2 tool_use
        Assert.Equal("text", content[0].GetProperty("type").GetString());
        Assert.Equal("tool_use", content[1].GetProperty("type").GetString());
        Assert.Equal("tool_use", content[2].GetProperty("type").GetString());

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
        using var rawResponse = JsonDocument.Parse(
            """{"content":[{"type":"tool_use","id":"call_1","name":"fn","input":{}}]}""");

        var messages = executor.FormatToolMessages(rawResponse.RootElement, toolCalls, toolResults);

        var content = Assert.IsType<JsonElement>(messages[0].Metadata["content"]);
        Assert.Single(content.EnumerateArray()); // Only tool_use, no text block
        Assert.Equal("tool_use", content[0].GetProperty("type").GetString());
    }

    [Fact]
    public void FormatToolMessages_RoundTripsCorrelatedBlocksIntoNextRequest()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var agent = TestHelpers.CreateAgent(provider: "anthropic");
        using var rawResponse = JsonDocument.Parse(
            """
            {
              "content": [
                {"type":"thinking","thinking":"I should look this up.","signature":"signed-thinking"},
                {"type":"text","text":"Checking."},
                {"type":"tool_use","id":"call_1","name":"lookup","input":{"key":"value"}}
              ]
            }
            """);
        var messages = executor.FormatToolMessages(
            rawResponse.RootElement,
            [new ToolCall { Id = "call_1", Name = "lookup", Arguments = """{"key":"value"}""" }],
            ["result"],
            "Checking.");

        var body = executor.BuildRequestBody(agent, messages, stream: false);
        var wireMessages = Assert.IsType<List<Dictionary<string, object?>>>(body["messages"]);

        var assistantContent = Assert.IsType<JsonElement>(wireMessages[0]["content"]);
        Assert.Equal("thinking", assistantContent[0].GetProperty("type").GetString());
        Assert.Equal("signed-thinking", assistantContent[0].GetProperty("signature").GetString());
        Assert.Equal("text", assistantContent[1].GetProperty("type").GetString());
        Assert.Equal("tool_use", assistantContent[2].GetProperty("type").GetString());
        Assert.Equal("call_1", assistantContent[2].GetProperty("id").GetString());

        var userContent = Assert.IsType<List<Dictionary<string, object?>>>(wireMessages[1]["content"]);
        Assert.Equal("tool_result", userContent[0]["type"]);
        Assert.Equal("call_1", userContent[0]["tool_use_id"]);
        Assert.Equal("result", userContent[0]["content"]);
    }

    [Fact]
    public async Task FormatToolMessages_ReconstructsStreamingToolAndThinkingBlocks()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var stream = new PromptyStream(StreamEvents(
            """{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}""",
            """{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"I should look."}}""",
            """{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signed"}}""",
            """{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}""",
            """{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Checking "}}""",
            """{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"now."}}""",
            """{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"call_1","name":"lookup","input":{}}}""",
            """{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"key\":\"value\"}"}}"""));
        await foreach (var _ in stream)
        {
        }

        var messages = executor.FormatToolMessages(
            stream,
            [new ToolCall { Id = "call_1", Name = "lookup", Arguments = """{"key":"value"}""" }],
            ["result"]);
        var content = Assert.IsType<List<Dictionary<string, object?>>>(messages[0].Metadata["content"]);

        Assert.Equal("thinking", content[0]["type"]?.ToString());
        Assert.Equal("I should look.", content[0]["thinking"]);
        Assert.Equal("signed", content[0]["signature"]);
        Assert.Equal("text", content[1]["type"]?.ToString());
        Assert.Equal("Checking now.", content[1]["text"]);
        Assert.Equal("tool_use", content[2]["type"]?.ToString());
        Assert.Equal("call_1", content[2]["id"]?.ToString());
        Assert.Equal("""{"key":"value"}""", Assert.IsType<JsonElement>(content[2]["input"]).GetRawText());
    }

    [Fact]
    public async Task FormatToolMessages_PreservesValidInitialInputWhenStreamEndsMidJson()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var stream = new PromptyStream(StreamEvents(
            """{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_1","name":"lookup","input":{}}}""",
            """{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"key\":"}}"""));
        await foreach (var _ in stream)
        {
        }

        var messages = executor.FormatToolMessages(
            stream,
            [new ToolCall { Id = "call_1", Name = "lookup", Arguments = """{"key":""" }],
            ["invalid arguments"]);
        var content = Assert.IsType<List<Dictionary<string, object?>>>(messages[0].Metadata["content"]);

        Assert.Equal("{}", Assert.IsType<JsonElement>(content[0]["input"]).GetRawText());
    }

    [Fact]
    public void BuildRequestBody_SingleToolResultMetadata_PreservesCorrelation()
    {
        var executor = new Anthropic.AnthropicExecutor();
        var agent = TestHelpers.CreateAgent(provider: "anthropic");
        var message = new Message
        {
            Role = Role.Tool,
            Parts = [new TextPart { Value = "result" }],
            Metadata = new Dictionary<string, object> { ["tool_use_id"] = "call_2" },
        };

        var body = executor.BuildRequestBody(agent, [message], stream: false);
        var wireMessages = Assert.IsType<List<Dictionary<string, object?>>>(body["messages"]);
        var content = Assert.IsType<List<Dictionary<string, object?>>>(wireMessages[0]["content"]);

        Assert.Equal("call_2", content[0]["tool_use_id"]);
    }

    private static async IAsyncEnumerable<object> StreamEvents(params string[] events)
    {
        foreach (var json in events)
        {
            await Task.Yield();
            using var document = JsonDocument.Parse(json);
            yield return document.RootElement.Clone();
        }
    }
}

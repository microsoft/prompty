// Copyright (c) Microsoft. All rights reserved.

using System.ClientModel.Primitives;
using System.Text.Json;
using OpenAI.Chat;
using Prompty.Core;

namespace Prompty.OpenAI.Tests;

/// <summary>
/// Tests for OpenAI processor response extraction.
/// Uses BinaryData.FromString to create SDK response objects for testing.
/// </summary>
public class OpenAIProcessorTests
{
    private readonly OpenAI.OpenAIProcessor _processor = new();

    // -----------------------------------------------------------------------
    // Chat Completions
    // -----------------------------------------------------------------------

    [Fact]
    public async Task ProcessAsync_ChatCompletion_ExtractsText()
    {
        var completion = CreateChatCompletion("Hello, world!");
        var agent = new Core.Prompty();

        var result = await _processor.ProcessAsync(agent, completion);

        Assert.Equal("Hello, world!", result);
    }

    [Fact]
    public async Task ProcessAsync_ChatCompletion_WithToolCalls_ReturnsToolCallResult()
    {
        var completion = CreateChatCompletionWithToolCalls(
            [("call_1", "get_weather", """{"city":"NYC"}""")]);
        var agent = new Core.Prompty();

        var result = await _processor.ProcessAsync(agent, completion);

        var tcr = Assert.IsType<ToolCallResult>(result);
        Assert.Single(tcr.ToolCalls);
        Assert.Equal("call_1", tcr.ToolCalls[0].Id);
        Assert.Equal("get_weather", tcr.ToolCalls[0].Name);
        Assert.Equal("""{"city":"NYC"}""", tcr.ToolCalls[0].Arguments);
    }

    [Fact]
    public async Task ProcessAsync_ChatCompletion_WithMultipleToolCalls()
    {
        var completion = CreateChatCompletionWithToolCalls(
        [
            ("call_1", "get_weather", """{"city":"NYC"}"""),
            ("call_2", "get_time", """{"tz":"EST"}"""),
        ]);
        var agent = new Core.Prompty();

        var result = await _processor.ProcessAsync(agent, completion);

        var tcr = Assert.IsType<ToolCallResult>(result);
        Assert.Equal(2, tcr.ToolCalls.Count);
    }

    [Fact]
    public async Task ProcessAsync_ChatCompletion_StructuredOutput_ParsesJson()
    {
        var jsonContent = """{"answer":"42","confidence":0.95}""";
        var completion = CreateChatCompletion(jsonContent);
        var agent = new Core.Prompty
        {
            Outputs =
            [
                new Property { Name = "answer", Kind = "string" },
                new Property { Name = "confidence", Kind = "float" },
            ],
        };

        var result = await _processor.ProcessAsync(agent, completion);

        Assert.IsType<StructuredResult>(result);
        var sr = (StructuredResult)result;
        Assert.Equal("42", sr["answer"]?.ToString());
    }

    [Fact]
    public async Task ProcessAsync_ChatCompletion_StructuredOutput_InvalidJson_FallsBackToString()
    {
        var completion = CreateChatCompletion("not valid json {{{");
        var agent = new Core.Prompty
        {
            Outputs = [new Property { Name = "x", Kind = "string" }],
        };

        var result = await _processor.ProcessAsync(agent, completion);

        Assert.IsType<string>(result);
        Assert.Equal("not valid json {{{", result);
    }

    [Fact]
    public async Task ProcessAsync_UnknownType_ReturnsAsIs()
    {
        var agent = new Core.Prompty();
        var unknownObj = new { custom = "value" };

        var result = await _processor.ProcessAsync(agent, unknownObj);

        Assert.Same(unknownObj, result);
    }

    // -----------------------------------------------------------------------
    // Helpers to create OpenAI SDK objects via BinaryData deserialization
    // -----------------------------------------------------------------------

    private static ChatCompletion CreateChatCompletion(string content)
    {
        var json = $$"""
        {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": {{JsonSerializer.Serialize(content)}}
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20,
                "total_tokens": 30
            }
        }
        """;
        return ModelReaderWriter.Read<ChatCompletion>(BinaryData.FromString(json))!;
    }

    private static ChatCompletion CreateChatCompletionWithToolCalls(
        List<(string id, string name, string args)> toolCalls)
    {
        var toolCallsJson = string.Join(",", toolCalls.Select(tc =>
            $$"""
            {
                "id": "{{tc.id}}",
                "type": "function",
                "function": {
                    "name": "{{tc.name}}",
                    "arguments": {{JsonSerializer.Serialize(tc.args)}}
                }
            }
            """));

        var json = $$"""
        {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 1700000000,
            "model": "gpt-4",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": null,
                        "tool_calls": [{{toolCallsJson}}]
                    },
                    "finish_reason": "tool_calls"
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20,
                "total_tokens": 30
            }
        }
        """;
        return ModelReaderWriter.Read<ChatCompletion>(BinaryData.FromString(json))!;
    }
}


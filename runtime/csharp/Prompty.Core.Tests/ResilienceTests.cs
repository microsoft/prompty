// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

// ──────────────────────────────────────────
//  Mock executor that can be configured to throw
// ──────────────────────────────────────────

/// <summary>
/// A mock executor that tracks calls and can throw on demand.
/// Each call either throws the next queued exception or returns the next queued response.
/// </summary>
file class ThrowingMockExecutor : IExecutor
{
    private readonly Queue<object?> _responses = new();
    private readonly Queue<Exception?> _exceptions = new();

    public List<List<Message>> Calls { get; } = [];

    public void EnqueueResponse(object response) => _responses.Enqueue(response);
    public void EnqueueException(Exception ex) => _exceptions.Enqueue(ex);

    public Task<object> ExecuteAsync(Prompty agent, List<Message> messages)
    {
        Calls.Add(new List<Message>(messages));

        // Check if we should throw
        if (_exceptions.Count > 0)
        {
            var ex = _exceptions.Dequeue();
            if (ex is not null)
                return Task.FromException<object>(ex);
        }

        return Task.FromResult(_responses.Dequeue()!);
    }

    public List<Message> FormatToolMessages(
        object rawResponse,
        List<ToolCall> toolCalls,
        List<string> toolResults,
        string? textContent = null)
    {
        var msgs = new List<Message>();
        msgs.Add(new Message
        {
            Role = Roles.Assistant,
            Parts = [new TextPart { Value = textContent ?? "" }],
            Metadata = new Dictionary<string, object?> { ["tool_calls"] = toolCalls }
        });
        for (int i = 0; i < toolCalls.Count; i++)
        {
            msgs.Add(new Message
            {
                Role = Roles.Tool,
                Parts = [new TextPart { Value = toolResults[i] }],
                Metadata = new Dictionary<string, object?> { ["tool_call_id"] = toolCalls[i].Id }
            });
        }
        return msgs;
    }
}

/// <summary>A passthrough renderer for resilience tests.</summary>
file class PassthroughRenderer : IRenderer
{
    public Task<string> RenderAsync(Prompty agent, string template, Dictionary<string, object?> inputs)
        => Task.FromResult(template);
}

/// <summary>A passthrough parser for resilience tests.</summary>
file class PassthroughParser : IParser
{
    public Task<List<Message>> ParseAsync(Prompty agent, string rendered)
        => Task.FromResult(new List<Message>
        {
            new() { Role = Roles.User, Parts = [new TextPart { Value = rendered }] }
        });
}

/// <summary>A passthrough processor for resilience tests.</summary>
file class PassthroughProcessor : IProcessor
{
    public Task<object> ProcessAsync(Prompty agent, object response) =>
        Task.FromResult(response);
}

/// <summary>Shared test helpers for resilience tests.</summary>
file static class ResilienceHelper
{
    public const string TestProvider = "test-resilience";

    public static Prompty CreateAgent(string instructions = "Hello")
    {
        return new Prompty
        {
            Name = "test-resilience-agent",
            Instructions = instructions,
            Model = new Model { Id = "test-model", Provider = TestProvider },
            Template = new Template
            {
                Format = new FormatConfig { Kind = "test-resilience-passthrough" },
                Parser = new ParserConfig { Kind = "test-resilience-passthrough" },
            }
        };
    }

    public static ThrowingMockExecutor Register(ThrowingMockExecutor? executor = null)
    {
        executor ??= new ThrowingMockExecutor();
        InvokerRegistry.RegisterRenderer("test-resilience-passthrough", new PassthroughRenderer());
        InvokerRegistry.RegisterParser("test-resilience-passthrough", new PassthroughParser());
        InvokerRegistry.RegisterExecutor(TestProvider, executor);
        InvokerRegistry.RegisterProcessor(TestProvider, new PassthroughProcessor());
        return executor;
    }

    public static ToolCallResult MakeToolCallResult(string name, string argsJson, string id = "call_1")
    {
        return new ToolCallResult
        {
            ToolCalls =
            [
                new ToolCall { Id = id, Name = name, Arguments = argsJson }
            ]
        };
    }
}

// ──────────────────────────────────────────
//  §9.8: Resilient JSON Parsing Tests
// ──────────────────────────────────────────

[Collection("InvokerRegistry")]
public class ResilientJsonParsingTests
{
    [Fact]
    public void ParseArguments_ValidJson_ParsesDirectly()
    {
        var result = ToolDispatch.ParseArguments("""{"city": "NY"}""");
        Assert.Equal("NY", result["city"]?.ToString());
    }

    [Fact]
    public void ParseArguments_MarkdownFences_Stripped()
    {
        var result = ToolDispatch.ParseArguments("```json\n{\"city\": \"NY\"}\n```");
        Assert.Equal("NY", result["city"]?.ToString());
    }

    [Fact]
    public void ParseArguments_MarkdownFencesNoLanguage_Stripped()
    {
        var result = ToolDispatch.ParseArguments("```\n{\"city\": \"NY\"}\n```");
        Assert.Equal("NY", result["city"]?.ToString());
    }

    [Fact]
    public void ParseArguments_JsonInProse_Extracted()
    {
        var result = ToolDispatch.ParseArguments("Here is: {\"city\": \"NY\"} done");
        Assert.Equal("NY", result["city"]?.ToString());
    }

    [Fact]
    public void ParseArguments_TrailingCommas_Cleaned()
    {
        var result = ToolDispatch.ParseArguments("{\"city\": \"NY\",}");
        Assert.Equal("NY", result["city"]?.ToString());
    }

    [Fact]
    public void ParseArguments_TrailingCommaInArray_Cleaned()
    {
        var result = ToolDispatch.ParseArguments("{\"items\": [1, 2,]}");
        Assert.False(result.ContainsKey("_error"));
    }

    [Fact]
    public void ParseArguments_Garbage_ReturnsError()
    {
        var result = ToolDispatch.ParseArguments("not json at all");
        Assert.True(result.ContainsKey("_error"));
    }

    [Fact]
    public void ParseArguments_EmptyString_ReturnsEmptyDict()
    {
        var result = ToolDispatch.ParseArguments("");
        Assert.Empty(result);
    }

    [Fact]
    public void ParseArguments_WhitespaceOnly_ReturnsEmptyDict()
    {
        var result = ToolDispatch.ParseArguments("   ");
        Assert.Empty(result);
    }

    [Fact]
    public void ExtractFirstJsonBlock_RespectsStrings()
    {
        var block = ToolDispatch.ExtractFirstJsonBlock("prefix {\"k\": \"v{x}\"} suffix");
        Assert.NotNull(block);
        var parsed = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(block!);
        Assert.Equal("v{x}", parsed!["k"]);
    }

    [Fact]
    public void ExtractFirstJsonBlock_NestedObjects()
    {
        var block = ToolDispatch.ExtractFirstJsonBlock("text {\"a\": {\"b\": 1}} end");
        Assert.NotNull(block);
        Assert.Equal("{\"a\": {\"b\": 1}}", block);
    }

    [Fact]
    public void ExtractFirstJsonBlock_NoBraces_ReturnsNull()
    {
        var block = ToolDispatch.ExtractFirstJsonBlock("no json here");
        Assert.Null(block);
    }

    [Fact]
    public void ExtractFirstJsonBlock_EscapedQuotes()
    {
        var block = ToolDispatch.ExtractFirstJsonBlock("""stuff {"key": "val\"ue"} end""");
        Assert.NotNull(block);
        Assert.Contains("key", block!);
    }
}

// ──────────────────────────────────────────
//  §9.9: Tool Execution Error Safety Tests
// ──────────────────────────────────────────

[Collection("InvokerRegistry")]
public class ToolExecutionErrorSafetyTests : IDisposable
{
    public ToolExecutionErrorSafetyTests()
    {
        InvokerRegistry.Clear();
        ToolDispatch.ClearTools();
        ToolDispatch.ClearToolHandlers();
    }

    public void Dispose()
    {
        InvokerRegistry.Clear();
        ToolDispatch.ClearTools();
        ToolDispatch.ClearToolHandlers();
    }

    [Fact]
    public async Task ToolDispatch_HandlerThrows_LoopContinuesWithErrorFeedback()
    {
        var executor = ResilienceHelper.Register();

        // First call: executor returns tool call
        executor.EnqueueResponse(ResilienceHelper.MakeToolCallResult(
            "bad_tool", """{"x":"1"}"""));
        // Second call: executor returns final answer (after receiving error feedback)
        executor.EnqueueResponse("recovered from error");

        var agent = ResilienceHelper.CreateAgent();
        agent.Tools =
        [
            new FunctionTool { Name = "bad_tool", Kind = "function" }
        ];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["bad_tool"] = _ => throw new InvalidOperationException("boom")
        };

        var result = await Pipeline.TurnAsync(agent, tools: tools);
        Assert.Equal("recovered from error", result);
        // Executor was called twice: first returned tool call, second got error feedback + final answer
        Assert.Equal(2, executor.Calls.Count);
    }

    [Fact]
    public async Task ToolDispatch_HandlerThrows_ErrorMessageSentToLlm()
    {
        var executor = ResilienceHelper.Register();

        executor.EnqueueResponse(ResilienceHelper.MakeToolCallResult(
            "failing_tool", """{"a":"b"}"""));
        executor.EnqueueResponse("final");

        var agent = ResilienceHelper.CreateAgent();
        agent.Tools =
        [
            new FunctionTool { Name = "failing_tool", Kind = "function" }
        ];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["failing_tool"] = _ => throw new InvalidOperationException("tool went wrong")
        };

        var result = await Pipeline.TurnAsync(agent, tools: tools);
        Assert.Equal("final", result);

        // The second call should have the error result in the messages
        var secondCallMessages = executor.Calls[1];
        var errorMsg = secondCallMessages.FirstOrDefault(m =>
            m.Role == Roles.Tool && m.Text.Contains("Error:") && m.Text.Contains("tool went wrong"));
        Assert.NotNull(errorMsg);
    }

    [Fact]
    public async Task ToolDispatch_HandlerThrows_EmitsErrorEvent()
    {
        var executor = ResilienceHelper.Register();

        executor.EnqueueResponse(ResilienceHelper.MakeToolCallResult(
            "err_tool", """{"x":"1"}"""));
        executor.EnqueueResponse("done");

        var agent = ResilienceHelper.CreateAgent();
        agent.Tools =
        [
            new FunctionTool { Name = "err_tool", Kind = "function" }
        ];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["err_tool"] = _ => throw new InvalidOperationException("kaboom")
        };

        var events = new List<(AgentEventType Type, Dictionary<string, object?> Data)>();
        EventCallback onEvent = (type, data) => events.Add((type, data));

        await Pipeline.TurnAsync(agent, tools: tools, onEvent: onEvent);

        var errorEvent = events.FirstOrDefault(e => e.Type == AgentEventType.Error);
        Assert.NotEqual(default, errorEvent);
        Assert.Equal("err_tool", errorEvent.Data["tool"]);
        Assert.Contains("kaboom", errorEvent.Data["error"]?.ToString());
    }

    [Fact]
    public async Task ToolDispatch_ParseError_ReturnsErrorStringToLlm()
    {
        var executor = ResilienceHelper.Register();

        // Tool call with completely invalid JSON
        executor.EnqueueResponse(new ToolCallResult
        {
            ToolCalls =
            [
                new ToolCall { Id = "call_bad", Name = "some_tool", Arguments = "totally not json" }
            ]
        });
        executor.EnqueueResponse("handled gracefully");

        var agent = ResilienceHelper.CreateAgent();
        agent.Tools =
        [
            new FunctionTool { Name = "some_tool", Kind = "function" }
        ];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["some_tool"] = args => Task.FromResult("should not reach")
        };

        var result = await Pipeline.TurnAsync(agent, tools: tools);
        Assert.Equal("handled gracefully", result);

        // The second call messages should contain an error about JSON parsing
        var secondCallMessages = executor.Calls[1];
        var errorToolMsg = secondCallMessages.FirstOrDefault(m =>
            m.Role == Roles.Tool && m.Text.Contains("Error:") && m.Text.Contains("Invalid JSON"));
        Assert.NotNull(errorToolMsg);
    }

    [Fact]
    public async Task ToolDispatch_ParallelPath_HandlerThrows_LoopContinues()
    {
        var executor = ResilienceHelper.Register();

        // Return two tool calls to trigger parallel path
        executor.EnqueueResponse(new ToolCallResult
        {
            ToolCalls =
            [
                new ToolCall { Id = "call_1", Name = "good_tool", Arguments = """{"x":"1"}""" },
                new ToolCall { Id = "call_2", Name = "bad_tool", Arguments = """{"x":"2"}""" }
            ]
        });
        executor.EnqueueResponse("parallel recovered");

        var agent = ResilienceHelper.CreateAgent();
        agent.Tools =
        [
            new FunctionTool { Name = "good_tool", Kind = "function" },
            new FunctionTool { Name = "bad_tool", Kind = "function" }
        ];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["good_tool"] = _ => Task.FromResult("ok"),
            ["bad_tool"] = _ => throw new InvalidOperationException("parallel boom")
        };

        var result = await Pipeline.TurnAsync(agent, tools: tools, parallelToolCalls: true);
        Assert.Equal("parallel recovered", result);
        Assert.Equal(2, executor.Calls.Count);
    }
}

// ──────────────────────────────────────────
//  §9.10: LLM Call Retry Tests
// ──────────────────────────────────────────

[Collection("InvokerRegistry")]
public class LlmCallRetryTests : IDisposable
{
    public LlmCallRetryTests()
    {
        InvokerRegistry.Clear();
        ToolDispatch.ClearTools();
        ToolDispatch.ClearToolHandlers();
    }

    public void Dispose()
    {
        InvokerRegistry.Clear();
        ToolDispatch.ClearTools();
        ToolDispatch.ClearToolHandlers();
    }

    [Fact]
    public async Task LlmRetry_SucceedsOnSecondAttempt()
    {
        var executor = new ThrowingMockExecutor();
        InvokerRegistry.RegisterRenderer("test-resilience-passthrough", new PassthroughRenderer());
        InvokerRegistry.RegisterParser("test-resilience-passthrough", new PassthroughParser());
        InvokerRegistry.RegisterExecutor(ResilienceHelper.TestProvider, executor);
        InvokerRegistry.RegisterProcessor(ResilienceHelper.TestProvider, new PassthroughProcessor());

        // First call throws, second succeeds
        executor.EnqueueException(new HttpRequestException("Service unavailable"));
        executor.EnqueueResponse("success after retry");

        var agent = ResilienceHelper.CreateAgent();
        // Need tools or agent features to enter agent loop path
        agent.Tools = [new FunctionTool { Name = "dummy", Kind = "function" }];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["dummy"] = s => Task.FromResult("ok")
        };

        var result = await Pipeline.TurnAsync(agent, tools: tools, maxLlmRetries: 3);
        Assert.Equal("success after retry", result);
        // Two executor calls: first threw, second succeeded
        Assert.Equal(2, executor.Calls.Count);
    }

    [Fact]
    public async Task LlmRetry_EmitsStatusEvent()
    {
        var executor = new ThrowingMockExecutor();
        InvokerRegistry.RegisterRenderer("test-resilience-passthrough", new PassthroughRenderer());
        InvokerRegistry.RegisterParser("test-resilience-passthrough", new PassthroughParser());
        InvokerRegistry.RegisterExecutor(ResilienceHelper.TestProvider, executor);
        InvokerRegistry.RegisterProcessor(ResilienceHelper.TestProvider, new PassthroughProcessor());

        executor.EnqueueException(new HttpRequestException("timeout"));
        executor.EnqueueResponse("ok");

        var agent = ResilienceHelper.CreateAgent();
        agent.Tools = [new FunctionTool { Name = "dummy", Kind = "function" }];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["dummy"] = s => Task.FromResult("ok")
        };

        var events = new List<(AgentEventType Type, Dictionary<string, object?> Data)>();
        EventCallback onEvent = (type, data) => events.Add((type, data));

        await Pipeline.TurnAsync(agent, tools: tools, maxLlmRetries: 3, onEvent: onEvent);

        var retryEvent = events.FirstOrDefault(e =>
            e.Type == AgentEventType.Status &&
            e.Data.ContainsKey("message") &&
            e.Data["message"]?.ToString()?.Contains("retrying") == true);
        Assert.NotEqual(default, retryEvent);
    }

    [Fact]
    public async Task LlmRetry_Exhausted_ThrowsExecuteError()
    {
        var executor = new ThrowingMockExecutor();
        InvokerRegistry.RegisterRenderer("test-resilience-passthrough", new PassthroughRenderer());
        InvokerRegistry.RegisterParser("test-resilience-passthrough", new PassthroughParser());
        InvokerRegistry.RegisterExecutor(ResilienceHelper.TestProvider, executor);
        InvokerRegistry.RegisterProcessor(ResilienceHelper.TestProvider, new PassthroughProcessor());

        // All attempts fail
        executor.EnqueueException(new HttpRequestException("fail 1"));
        executor.EnqueueException(new HttpRequestException("fail 2"));

        var agent = ResilienceHelper.CreateAgent();
        agent.Tools = [new FunctionTool { Name = "dummy", Kind = "function" }];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["dummy"] = s => Task.FromResult("ok")
        };

        var ex = await Assert.ThrowsAsync<ExecuteError>(() =>
            Pipeline.TurnAsync(agent, tools: tools, maxLlmRetries: 2));

        Assert.Contains("2 retries", ex.Message);
        Assert.NotNull(ex.Messages);
        Assert.NotEmpty(ex.Messages);
    }

    [Fact]
    public async Task LlmRetry_ExecuteError_ContainsConversationState()
    {
        var executor = new ThrowingMockExecutor();
        InvokerRegistry.RegisterRenderer("test-resilience-passthrough", new PassthroughRenderer());
        InvokerRegistry.RegisterParser("test-resilience-passthrough", new PassthroughParser());
        InvokerRegistry.RegisterExecutor(ResilienceHelper.TestProvider, executor);
        InvokerRegistry.RegisterProcessor(ResilienceHelper.TestProvider, new PassthroughProcessor());

        executor.EnqueueException(new HttpRequestException("always fails"));

        var agent = ResilienceHelper.CreateAgent("My prompt");
        agent.Tools = [new FunctionTool { Name = "dummy", Kind = "function" }];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["dummy"] = s => Task.FromResult("ok")
        };

        var ex = await Assert.ThrowsAsync<ExecuteError>(() =>
            Pipeline.TurnAsync(agent, tools: tools, maxLlmRetries: 1));

        // Messages should contain the prepared messages
        Assert.NotEmpty(ex.Messages);
        var hasUserMsg = ex.Messages.Any(m => m.Role == Roles.User && m.Text.Contains("My prompt"));
        Assert.True(hasUserMsg);
    }

    [Fact]
    public async Task LlmRetry_CancellationRespected_DuringBackoff()
    {
        var executor = new ThrowingMockExecutor();
        InvokerRegistry.RegisterRenderer("test-resilience-passthrough", new PassthroughRenderer());
        InvokerRegistry.RegisterParser("test-resilience-passthrough", new PassthroughParser());
        InvokerRegistry.RegisterExecutor(ResilienceHelper.TestProvider, executor);
        InvokerRegistry.RegisterProcessor(ResilienceHelper.TestProvider, new PassthroughProcessor());

        // Always fail to trigger backoff
        executor.EnqueueException(new HttpRequestException("fail"));
        executor.EnqueueException(new HttpRequestException("fail"));
        executor.EnqueueException(new HttpRequestException("fail"));

        var agent = ResilienceHelper.CreateAgent();
        agent.Tools = [new FunctionTool { Name = "dummy", Kind = "function" }];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["dummy"] = s => Task.FromResult("ok")
        };

        var cts = new CancellationTokenSource();
        // Cancel quickly during backoff
        cts.CancelAfter(TimeSpan.FromMilliseconds(100));

        // Should throw OperationCanceledException or TaskCanceledException during backoff
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Pipeline.TurnAsync(agent, tools: tools, maxLlmRetries: 5,
                cancellationToken: cts.Token));
    }

    [Fact]
    public async Task LlmRetry_SimplePath_NoRetry()
    {
        // Simple path (no tools, no agent features) should NOT use retry
        var executor = new ThrowingMockExecutor();
        InvokerRegistry.RegisterRenderer("test-resilience-passthrough", new PassthroughRenderer());
        InvokerRegistry.RegisterParser("test-resilience-passthrough", new PassthroughParser());
        InvokerRegistry.RegisterExecutor(ResilienceHelper.TestProvider, executor);
        InvokerRegistry.RegisterProcessor(ResilienceHelper.TestProvider, new PassthroughProcessor());

        executor.EnqueueException(new HttpRequestException("simple path fail"));

        var agent = ResilienceHelper.CreateAgent();
        // No tools — simple path

        // Should throw directly without retry
        await Assert.ThrowsAsync<HttpRequestException>(() =>
            Pipeline.TurnAsync(agent));
    }
}

// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

// ──────────────────────────────────────────
//  Mock invokers for the agent loop tests
// ──────────────────────────────────────────

/// <summary>
/// A passthrough renderer that returns the template unchanged.
/// </summary>
file class PassthroughRenderer : IRenderer
{
    public Task<string> RenderAsync(Prompty agent, string template, Dictionary<string, object?> inputs)
        => Task.FromResult(template);
}

/// <summary>
/// A passthrough parser that wraps the rendered text into a single user message.
/// </summary>
file class PassthroughParser : IParser
{
    public Task<List<Message>> ParseAsync(Prompty agent, string rendered)
        => Task.FromResult(new List<Message>
        {
            new() { Role = Roles.User, Parts = [new TextPart { Value = rendered }] }
        });
}

/// <summary>
/// A parser that returns a system message plus several long user/assistant turns.
/// Used to test context window trimming.
/// </summary>
file class MultiMessageParser : IParser
{
    public Task<List<Message>> ParseAsync(Prompty agent, string rendered)
    {
        var filler = new string('z', 300);
        return Task.FromResult(new List<Message>
        {
            new() { Role = Roles.System, Parts = [new TextPart { Value = "System prompt." }] },
            new() { Role = Roles.User, Parts = [new TextPart { Value = filler }] },
            new() { Role = Roles.Assistant, Parts = [new TextPart { Value = filler }] },
            new() { Role = Roles.User, Parts = [new TextPart { Value = filler }] },
            new() { Role = Roles.Assistant, Parts = [new TextPart { Value = filler }] },
            new() { Role = Roles.User, Parts = [new TextPart { Value = "latest question" }] },
            new() { Role = Roles.Assistant, Parts = [new TextPart { Value = "latest answer" }] },
        });
    }
}

/// <summary>
/// A mock executor that records calls and returns configurable responses.
/// Each call pops the next response from a queue.
/// </summary>
file class MockExecutor : IExecutor
{
    private readonly Queue<object> _responses = new();

    /// <summary>All message lists passed to ExecuteAsync, in order.</summary>
    public List<List<Message>> Calls { get; } = [];

    public void EnqueueResponse(object response) => _responses.Enqueue(response);

    public Task<object> ExecuteAsync(Prompty agent, List<Message> messages)
    {
        // Snapshot the messages at call time
        Calls.Add(new List<Message>(messages));
        return Task.FromResult(_responses.Dequeue());
    }

    public Task<List<Message>> FormatToolMessagesAsync(
        object rawResponse,
        List<ToolCall> toolCalls,
        List<string> toolResults,
        string? textContent = null)
    {
        var msgs = new List<Message>();
        // assistant message with tool calls
        msgs.Add(new Message
        {
            Role = Roles.Assistant,
            Parts = [new TextPart { Value = textContent ?? "" }],
            Metadata = new Dictionary<string, object?> { ["tool_calls"] = toolCalls }
        });
        // one tool-result message per call
        for (int i = 0; i < toolCalls.Count; i++)
        {
            msgs.Add(new Message
            {
                Role = Roles.Tool,
                Parts = [new TextPart { Value = toolResults[i] }],
                Metadata = new Dictionary<string, object?> { ["tool_call_id"] = toolCalls[i].Id }
            });
        }
        return Task.FromResult(msgs);
    }
}

/// <summary>
/// A mock processor. When the raw response is already a string it returns it;
/// when it is a ToolCallResult it returns it as-is so the pipeline detects tool calls.
/// </summary>
file class MockProcessor : IProcessor
{
    public Task<object> ProcessAsync(Prompty agent, object response) =>
        Task.FromResult(response);
}

// ──────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────

/// <summary>Shared helpers for building test agents and registering mocks.</summary>
file static class AgentLoopHelper
{
    public const string TestProvider = "test-agent-loop";

    /// <summary>
    /// Create a minimal Prompty agent whose Model.Provider points at TestProvider.
    /// </summary>
    public static Prompty CreateAgent(string instructions = "Hello")
    {
        return new Prompty
        {
            Name = "test-agent",
            Instructions = instructions,
            Model = new Model { Id = "test-model", Provider = TestProvider },
            Template = new Template
            {
                Format = new FormatConfig { Kind = "test-passthrough" },
                Parser = new ParserConfig { Kind = "test-passthrough" },
            }
        };
    }

    /// <summary>
    /// Register the passthrough renderer/parser and the given executor/processor.
    /// Returns the mock executor for assertion.
    /// </summary>
    public static MockExecutor Register(MockExecutor? executor = null, MockProcessor? processor = null, IParser? parser = null)
    {
        executor ??= new MockExecutor();
        processor ??= new MockProcessor();
        InvokerRegistry.RegisterRenderer("test-passthrough", new PassthroughRenderer());
        InvokerRegistry.RegisterParser("test-passthrough", parser ?? new PassthroughParser());
        InvokerRegistry.RegisterExecutor(TestProvider, executor);
        InvokerRegistry.RegisterProcessor(TestProvider, processor);
        return executor;
    }

    /// <summary>Build a ToolCallResult response with a single function call.</summary>
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
//  Integration Tests
// ──────────────────────────────────────────

[Collection("InvokerRegistry")]
public class AgentLoopIntegrationTests : IDisposable
{
    public AgentLoopIntegrationTests()
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

    // ──────────────────────────────────────
    //  1. First-turn guardrail denial
    // ──────────────────────────────────────

    [Fact]
    public async Task InputGuardrail_DeniesFirstTurn_ThrowsGuardrailError_ExecutorNeverCalled()
    {
        var executor = AgentLoopHelper.Register();
        // Enqueue a response that should never be consumed
        executor.EnqueueResponse("should not reach");

        var agent = AgentLoopHelper.CreateAgent();
        var guardrails = new Guardrails(
            input: _ => new GuardrailResult(false, "blocked by policy"));

        var ex = await Assert.ThrowsAsync<GuardrailError>(() =>
            Pipeline.TurnAsync(agent, guardrails: guardrails));

        Assert.Equal("blocked by policy", ex.Reason);
        Assert.Empty(executor.Calls); // executor was never called
    }

    // ──────────────────────────────────────
    //  2. Steering on first turn
    // ──────────────────────────────────────

    [Fact]
    public async Task Steering_InjectsMessagesBeforeFirstCall()
    {
        var executor = AgentLoopHelper.Register();
        executor.EnqueueResponse("final answer");

        var agent = AgentLoopHelper.CreateAgent("system prompt");
        var steering = new Steering();
        steering.Send("injected guidance");

        var result = await Pipeline.TurnAsync(agent, steering: steering);

        Assert.Equal("final answer", result);
        Assert.Single(executor.Calls);

        var sentMessages = executor.Calls[0];
        // The passthrough parser produces one user message from "system prompt".
        // Steering adds one user message "injected guidance" after that.
        Assert.True(sentMessages.Count >= 2, $"Expected ≥2 messages, got {sentMessages.Count}");

        var steeringMsg = sentMessages.FirstOrDefault(m =>
            m.Role == Roles.User && m.Text.Contains("injected guidance"));
        Assert.NotNull(steeringMsg);
    }

    // ──────────────────────────────────────
    //  3. Context trim before first call
    // ──────────────────────────────────────

    [Fact]
    public async Task ContextBudget_TrimsMessagesBeforeExecution()
    {
        var executor = AgentLoopHelper.Register(parser: new MultiMessageParser());
        executor.EnqueueResponse("trimmed answer");

        // Instructions don't matter; the custom parser produces many long messages
        var agent = AgentLoopHelper.CreateAgent("ignored");

        // Set a small budget that forces the trimmer to drop some messages
        var result = await Pipeline.TurnAsync(agent, contextBudget: 500);

        Assert.Equal("trimmed answer", result);
        Assert.Single(executor.Calls);

        var sentMessages = executor.Calls[0];
        // MultiMessageParser produces 1 system + 6 user/assistant messages.
        // With budget=500, at least some non-system messages must be dropped.
        Assert.True(sentMessages.Count < 7,
            $"Expected fewer than 7 messages after trim, got {sentMessages.Count}");
        // System message is always preserved
        Assert.Equal(Roles.System, sentMessages[0].Role);
    }

    // ──────────────────────────────────────
    //  4. Input guardrail rewrite
    // ──────────────────────────────────────

    [Fact]
    public async Task InputGuardrail_RewritesMessages_ExecutorSeesRewritten()
    {
        var executor = AgentLoopHelper.Register();
        executor.EnqueueResponse("after rewrite");

        var agent = AgentLoopHelper.CreateAgent();
        var rewritten = new List<Message>
        {
            new() { Role = Roles.System, Parts = [new TextPart { Value = "rewritten system" }] },
            new() { Role = Roles.User, Parts = [new TextPart { Value = "rewritten user" }] }
        };

        var guardrails = new Guardrails(
            input: _ => new GuardrailResult(true, rewrite: rewritten));

        var result = await Pipeline.TurnAsync(agent, guardrails: guardrails);

        Assert.Equal("after rewrite", result);
        Assert.Single(executor.Calls);

        var sentMessages = executor.Calls[0];
        Assert.Equal(2, sentMessages.Count);
        Assert.Equal("rewritten system", sentMessages[0].Text);
        Assert.Equal("rewritten user", sentMessages[1].Text);
    }

    // ──────────────────────────────────────
    //  5a. Output guardrail denial
    // ──────────────────────────────────────

    [Fact]
    public async Task OutputGuardrail_DeniesResponse_ThrowsGuardrailError()
    {
        var executor = AgentLoopHelper.Register();
        executor.EnqueueResponse("dangerous content");

        var agent = AgentLoopHelper.CreateAgent();
        var guardrails = new Guardrails(
            output: msg => new GuardrailResult(false, "output policy violation"));

        var ex = await Assert.ThrowsAsync<GuardrailError>(() =>
            Pipeline.TurnAsync(agent, guardrails: guardrails));

        Assert.Equal("output policy violation", ex.Reason);
    }

    // ──────────────────────────────────────
    //  5b. Output guardrail rewrite
    // ──────────────────────────────────────

    [Fact]
    public async Task OutputGuardrail_RewritesResponse_ReturnsSanitised()
    {
        var executor = AgentLoopHelper.Register();
        executor.EnqueueResponse("raw answer with PII");

        var agent = AgentLoopHelper.CreateAgent();
        var guardrails = new Guardrails(
            output: _ => new GuardrailResult(true, rewrite: "redacted answer"));

        var result = await Pipeline.TurnAsync(agent, guardrails: guardrails);

        Assert.Equal("redacted answer", result);
    }

    // ──────────────────────────────────────
    //  6. Tool guardrail rewrite
    // ──────────────────────────────────────

    [Fact]
    public async Task ToolGuardrail_RewritesArgs_ToolReceivesRewrittenArgs()
    {
        var executor = AgentLoopHelper.Register();

        // First call: executor returns a tool call
        executor.EnqueueResponse(AgentLoopHelper.MakeToolCallResult(
            "get_weather", """{"city":"Redmond"}"""));
        // Second call: executor returns final answer
        executor.EnqueueResponse("sunny in Seattle");

        var agent = AgentLoopHelper.CreateAgent();
        agent.Tools =
        [
            new FunctionTool { Name = "get_weather", Kind = "function" }
        ];

        string? capturedArgs = null;
        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["get_weather"] = args =>
            {
                capturedArgs = args;
                return Task.FromResult("72°F");
            }
        };

        var rewrittenArgs = new Dictionary<string, object?> { ["city"] = "Seattle" };
        var guardrails = new Guardrails(
            tool: (name, args) => new GuardrailResult(true, rewrite: rewrittenArgs));

        var result = await Pipeline.TurnAsync(agent, tools: tools, guardrails: guardrails);

        Assert.Equal("sunny in Seattle", result);
        Assert.NotNull(capturedArgs);
        // The guardrail rewrites the call.Arguments JSON; user tool receives the serialized form
        Assert.Contains("Seattle", capturedArgs);
        Assert.DoesNotContain("Redmond", capturedArgs);
    }

    // ──────────────────────────────────────
    //  7. Cancellation mid-loop
    // ──────────────────────────────────────

    [Fact]
    public async Task Cancellation_AfterFirstIteration_ThrowsOperationCancelled()
    {
        var executor = AgentLoopHelper.Register();
        var cts = new CancellationTokenSource();

        // First call: return a tool call so the loop iterates
        executor.EnqueueResponse(AgentLoopHelper.MakeToolCallResult(
            "do_work", """{"x":"1"}"""));
        // Second call: final answer (should not be reached)
        executor.EnqueueResponse("should not reach");

        var agent = AgentLoopHelper.CreateAgent();
        agent.Tools =
        [
            new FunctionTool { Name = "do_work", Kind = "function" }
        ];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["do_work"] = _ =>
            {
                // Cancel after the first tool execution
                cts.Cancel();
                return Task.FromResult("done");
            }
        };

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            Pipeline.TurnAsync(agent, tools: tools, cancellationToken: cts.Token));

        // Only the first executor call should have happened
        Assert.Single(executor.Calls);
    }

    // ──────────────────────────────────────
    //  8. Max iterations exceeded
    // ──────────────────────────────────────

    [Fact]
    public async Task MaxIterations_Exceeded_ThrowsInvalidOperationException()
    {
        var executor = AgentLoopHelper.Register();
        const int maxIter = 3;

        // Every call returns a tool call, so the loop never exits naturally
        for (int i = 0; i < maxIter + 1; i++)
        {
            executor.EnqueueResponse(AgentLoopHelper.MakeToolCallResult(
                "repeat", """{"n":"1"}""", id: $"call_{i}"));
        }

        var agent = AgentLoopHelper.CreateAgent();
        agent.Tools =
        [
            new FunctionTool { Name = "repeat", Kind = "function" }
        ];

        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["repeat"] = _ => Task.FromResult("again")
        };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Pipeline.TurnAsync(agent, tools: tools, maxIterations: maxIter));

        Assert.Contains($"{maxIter}", ex.Message);
    }
}

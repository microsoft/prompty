// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Providers.Tests;

/// <summary>
/// Tests for the agent loop (Pipeline.TurnAsync) with mock executors/processors.
/// </summary>
[Collection("ToolDispatch")]
public class AgentLoopTests : IDisposable
{
    public AgentLoopTests()
    {
        InvokerRegistry.Clear();
        ToolDispatch.ClearTools();
        ToolDispatch.ClearToolHandlers();
        ToolDispatch.RegisterBuiltins();

        // Register mock renderer + parser so PrepareAsync works
        InvokerRegistry.RegisterRenderer("jinja2", new PassthroughRenderer());
        InvokerRegistry.RegisterParser("prompty", new PassthroughParser());
    }

    public void Dispose()
    {
        InvokerRegistry.Clear();
        ToolDispatch.ClearTools();
        ToolDispatch.ClearToolHandlers();
    }

    [Fact]
    public async Task TurnAsync_NoToolCalls_ReturnsDirectly()
    {
        InvokerRegistry.RegisterExecutor("openai", new MockExecutor("Hello!"));
        InvokerRegistry.RegisterProcessor("openai", new MockProcessor());

        var agent = CreateTestAgent();

        var result = await Pipeline.TurnAsync(agent);

        Assert.Equal("Hello!", result);
    }

    [Fact]
    public async Task TurnAsync_SingleToolCall_ExecutesAndReturns()
    {
        var callCount = 0;
        var executor = new SequenceExecutor(
        [
            // First call: model wants to use a tool
            new ToolCallResult
            {
                ToolCalls = [new ToolCall { Id = "c1", Name = "get_weather", Arguments = """{"city":"NYC"}""" }],
            },
            // Second call: model gives final answer
            "The weather in NYC is 72°F and sunny.",
        ]);

        InvokerRegistry.RegisterExecutor("openai", executor);
        InvokerRegistry.RegisterProcessor("openai", new PassthroughProcessor());

        var agent = CreateTestAgent(
            tools: [new FunctionTool { Name = "get_weather", Kind = "function" }]);

        var userTools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["get_weather"] = args =>
            {
                callCount++;
                return Task.FromResult("72°F and sunny");
            },
        };

        var result = await Pipeline.TurnAsync(agent, tools: userTools);

        Assert.Equal("The weather in NYC is 72°F and sunny.", result);
        Assert.Equal(1, callCount);
    }

    [Fact]
    public async Task TurnAsync_MultipleToolCalls_ExecutesAll()
    {
        var executor = new SequenceExecutor(
        [
            new ToolCallResult
            {
                ToolCalls =
                [
                    new ToolCall { Id = "c1", Name = "get_weather", Arguments = """{"city":"NYC"}""" },
                    new ToolCall { Id = "c2", Name = "get_time", Arguments = """{"tz":"EST"}""" },
                ],
            },
            "NYC is 72°F at 3:00 PM EST.",
        ]);

        InvokerRegistry.RegisterExecutor("openai", executor);
        InvokerRegistry.RegisterProcessor("openai", new PassthroughProcessor());

        var agent = CreateTestAgent(tools:
        [
            new FunctionTool { Name = "get_weather", Kind = "function" },
            new FunctionTool { Name = "get_time", Kind = "function" },
        ]);

        var userTools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["get_weather"] = _ => Task.FromResult("72°F"),
            ["get_time"] = _ => Task.FromResult("3:00 PM EST"),
        };

        var result = await Pipeline.TurnAsync(agent, tools: userTools);

        Assert.Equal("NYC is 72°F at 3:00 PM EST.", result);
    }

    [Fact]
    public async Task TurnAsync_MultipleIterations()
    {
        var executor = new SequenceExecutor(
        [
            // Iteration 1: tool call
            new ToolCallResult
            {
                ToolCalls = [new ToolCall { Id = "c1", Name = "step1", Arguments = "{}" }],
            },
            // Iteration 2: another tool call
            new ToolCallResult
            {
                ToolCalls = [new ToolCall { Id = "c2", Name = "step2", Arguments = "{}" }],
            },
            // Iteration 3: final answer
            "done",
        ]);

        InvokerRegistry.RegisterExecutor("openai", executor);
        InvokerRegistry.RegisterProcessor("openai", new PassthroughProcessor());

        var agent = CreateTestAgent(tools:
        [
            new FunctionTool { Name = "step1", Kind = "function" },
            new FunctionTool { Name = "step2", Kind = "function" },
        ]);

        var userTools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["step1"] = _ => Task.FromResult("step1-result"),
            ["step2"] = _ => Task.FromResult("step2-result"),
        };

        var result = await Pipeline.TurnAsync(agent, tools: userTools);

        Assert.Equal("done", result);
        Assert.Equal(3, executor.CallCount);
    }

    [Fact]
    public async Task TurnAsync_MaxIterations_Throws()
    {
        // Executor always returns tool calls — infinite loop
        var infiniteExecutor = new InfiniteToolCallExecutor();
        InvokerRegistry.RegisterExecutor("openai", infiniteExecutor);
        InvokerRegistry.RegisterProcessor("openai", new PassthroughProcessor());

        var agent = CreateTestAgent(tools:
            [new FunctionTool { Name = "loop_fn", Kind = "function" }]);

        var userTools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["loop_fn"] = _ => Task.FromResult("looping"),
        };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => Pipeline.TurnAsync(agent, tools: userTools, maxIterations: 3));

        Assert.Contains("maximum iterations", ex.Message);
    }

    [Fact]
    public async Task TurnAsync_MissingTool_ErrorFedBackToLlm()
    {
        var executor = new SequenceExecutor(
        [
            new ToolCallResult
            {
                ToolCalls = [new ToolCall { Id = "c1", Name = "missing_tool", Arguments = "{}" }],
            },
            // Second response after error feedback — loop continues
            "recovered after missing tool",
        ]);

        InvokerRegistry.RegisterExecutor("openai", executor);
        InvokerRegistry.RegisterProcessor("openai", new PassthroughProcessor());

        var agent = CreateTestAgent(tools:
            [new FunctionTool { Name = "missing_tool", Kind = "function" }]);

        // With §9.9, tool errors are caught and fed back to the LLM.
        // The loop continues and returns the final response.
        var result = await Pipeline.TurnAsync(agent);
        Assert.Equal("recovered after missing tool", result);
    }

    [Fact]
    public async Task TurnAsync_GlobalRegisteredTool_Works()
    {
        ToolDispatch.RegisterTool("global_fn", _ => Task.FromResult("global-result"));

        var executor = new SequenceExecutor(
        [
            new ToolCallResult
            {
                ToolCalls = [new ToolCall { Id = "c1", Name = "global_fn", Arguments = "{}" }],
            },
            "Final answer using global tool.",
        ]);

        InvokerRegistry.RegisterExecutor("openai", executor);
        InvokerRegistry.RegisterProcessor("openai", new PassthroughProcessor());

        var agent = CreateTestAgent(tools:
            [new FunctionTool { Name = "global_fn", Kind = "function" }]);

        var result = await Pipeline.TurnAsync(agent);

        Assert.Equal("Final answer using global tool.", result);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private static Core.Prompty CreateTestAgent(
        IList<Tool>? tools = null,
        string provider = "openai")
    {
        return new Core.Prompty
        {
            Name = "test-agent",
            Instructions = "You are a test assistant.",
            Model = new Model
            {
                Id = "gpt-4",
                Provider = provider,
            },
            Tools = tools,
            Template = new Template
            {
                Format = new FormatConfig { Kind = "jinja2" },
                Parser = new ParserConfig { Kind = "prompty" },
            },
        };
    }

    /// <summary>Renderer that returns instructions as-is.</summary>
    private class PassthroughRenderer : IRenderer
    {
        public Task<string> RenderAsync(Core.Prompty agent, string template, Dictionary<string, object?> inputs)
            => Task.FromResult(template);
    }

    /// <summary>Parser that returns a single user message.</summary>
    private class PassthroughParser : IParser
    {
        public Task<List<Message>> ParseAsync(Core.Prompty agent, string rendered, Dictionary<string, object?>? context)
            => Task.FromResult<List<Message>>([new() { Role = Roles.User, Parts = [new TextPart { Value = rendered }] }]);
    }

    /// <summary>Executor that returns a fixed response.</summary>
    private class MockExecutor(object response) : IExecutor
    {
        public Task<object> ExecuteAsync(Core.Prompty agent, List<Message> messages)
            => Task.FromResult(response);

        public List<Message> FormatToolMessages(object rawResponse, List<ToolCall> toolCalls, List<string> toolResults, string? textContent = null)
            => DefaultFormatToolMessages(toolCalls, toolResults, textContent);
    }

    /// <summary>Processor that returns the value as-is (identity).</summary>
    private class PassthroughProcessor : IProcessor
    {
        public Task<object> ProcessAsync(Core.Prompty agent, object response)
            => Task.FromResult(response);
    }

    /// <summary>Simple processor that just returns text responses as strings.</summary>
    private class MockProcessor : IProcessor
    {
        public Task<object> ProcessAsync(Core.Prompty agent, object response)
            => Task.FromResult(response);
    }

    /// <summary>Executor that returns responses in sequence.</summary>
    private class SequenceExecutor(List<object> responses) : IExecutor
    {
        private int _index;
        public int CallCount => _index;

        public Task<object> ExecuteAsync(Core.Prompty agent, List<Message> messages)
        {
            if (_index >= responses.Count)
                throw new InvalidOperationException("SequenceExecutor ran out of responses.");
            return Task.FromResult(responses[_index++]);
        }

        public List<Message> FormatToolMessages(object rawResponse, List<ToolCall> toolCalls, List<string> toolResults, string? textContent = null)
            => DefaultFormatToolMessages(toolCalls, toolResults, textContent);
    }

    /// <summary>Executor that always returns a tool call — for testing max iterations.</summary>
    private class InfiniteToolCallExecutor : IExecutor
    {
        public Task<object> ExecuteAsync(Core.Prompty agent, List<Message> messages)
        {
            return Task.FromResult<object>(new ToolCallResult
            {
                ToolCalls = [new ToolCall { Id = $"c{Guid.NewGuid()}", Name = "loop_fn", Arguments = "{}" }],
            });
        }

        public List<Message> FormatToolMessages(object rawResponse, List<ToolCall> toolCalls, List<string> toolResults, string? textContent = null)
            => DefaultFormatToolMessages(toolCalls, toolResults, textContent);
    }

    /// <summary>Default OpenAI-style format for mock executors.</summary>
    private static List<Message> DefaultFormatToolMessages(List<ToolCall> toolCalls, List<string> toolResults, string? textContent)
    {
        var messages = new List<Message>
        {
            new() { Role = Roles.Assistant, Parts = string.IsNullOrEmpty(textContent) ? [] : [new TextPart { Value = textContent }], Metadata = new Dictionary<string, object> { ["tool_calls"] = toolCalls } },
        };
        for (var i = 0; i < toolCalls.Count; i++)
            messages.Add(new() { Role = Roles.Tool, Parts = [new TextPart { Value = toolResults[i] }], Metadata = new Dictionary<string, object> { ["tool_call_id"] = toolCalls[i].Id, ["name"] = toolCalls[i].Name } });
        return messages;
    }
}

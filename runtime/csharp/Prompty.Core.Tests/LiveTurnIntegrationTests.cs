// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

[Collection("InvokerRegistry")]
public sealed class LiveTurnIntegrationTests : IDisposable
{
    private const string Provider = "live-turn-test";
    private const string Format = "live-turn-format";

    public LiveTurnIntegrationTests()
    {
        InvokerRegistry.Clear();
        InvokerRegistry.RegisterRenderer(Format, new PassthroughRenderer());
        InvokerRegistry.RegisterParser(Format, new PassthroughParser());
        InvokerRegistry.RegisterProcessor(Provider, new PassthroughProcessor());
    }

    public void Dispose() => InvokerRegistry.Clear();

    [Fact]
    public async Task TurnWithEngineRequest_PersistsAtomicCheckpoints_AndResumesWithoutReinvocation()
    {
        var executor = new QueueExecutor("durable result");
        InvokerRegistry.RegisterExecutor(Provider, executor);
        var durability = new AtomicRecordingDurability();
        durability.FailAfter = EngineEventKind.ModelInvocationCompleted;
        var options = new TurnEnginePipelineOptions { Durability = durability };

        await Assert.ThrowsAsync<TurnEngineRecoveryRequiredException>(() =>
            Pipeline.TurnWithEngineRequestAsync(
                NewAgent(),
                NewRequest("durable-session", "durable-turn"),
                options));
        Assert.NotEmpty(durability.AtomicAppends);
        Assert.All(durability.AtomicAppends, append =>
        {
            Assert.NotEmpty(append.Events);
            var semanticTail = append.Events.Last(@event => @event.Kind != EngineEventKind.CheckpointCreated);
            Assert.Equal(semanticTail.Sequence, append.Checkpoint.LastSequence);
        });

        var checkpoint = durability.AtomicAppends[^1].Checkpoint;
        durability.FailAfter = null;
        var resume = TurnEngineRequest.ResumeFrom(checkpoint, maxIterations: 3, checkpoint.LastSequence);
        var resumed = await Pipeline.TurnWithEngineRequestAsync(NewAgent(), resume, options);

        Assert.Equal("durable result", resumed);
        Assert.Equal(1, executor.InvocationCount);
    }

    [Fact]
    public async Task TurnWithEngineRequest_CancellationPersistsTerminalCheckpoint()
    {
        InvokerRegistry.RegisterExecutor(Provider, new QueueExecutor("unused"));
        var durability = new AtomicRecordingDurability();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Pipeline.TurnWithEngineRequestAsync(
                NewAgent(),
                NewRequest("cancel-session", "cancel-turn"),
                new TurnEnginePipelineOptions { Durability = durability },
                cancellation.Token));

        var events = durability.StandaloneEvents
            .Concat(durability.AtomicAppends.SelectMany(append => append.Events));
        Assert.Contains(events, @event => @event.Kind == EngineEventKind.TurnCancelled);
        if (durability.AtomicAppends.Count > 0)
        {
            Assert.Equal(
                durability.AtomicAppends[^1].Events[^1].Sequence,
                durability.AtomicAppends[^1].Checkpoint.LastSequence);
        }
    }

    [Fact]
    public async Task TurnWithEngineRequest_RejectsNonObjectInputs()
    {
        var executor = new QueueExecutor("unused");
        InvokerRegistry.RegisterExecutor(Provider, executor);
        var request = NewRequest("invalid-input-session", "invalid-input-turn");
        request.Inputs = "not-an-input-object";

        var error = await Assert.ThrowsAsync<ArgumentException>(() =>
            Pipeline.TurnWithEngineRequestAsync(NewAgent(), request));

        Assert.Contains("string-keyed dictionary or JSON object", error.Message, StringComparison.Ordinal);
        Assert.Equal(0, executor.InvocationCount);
    }

    [Fact]
    public async Task TurnAsync_RejectsParallelToolsBeforeInvokingProvider()
    {
        var executor = new QueueExecutor("unused");
        InvokerRegistry.RegisterExecutor(Provider, executor);
        var agent = NewAgent();
        agent.Tools = [new FunctionTool { Name = "lookup", Kind = "function" }];

        var error = await Assert.ThrowsAsync<ArgumentException>(() =>
            Pipeline.TurnAsync(agent, parallelToolCalls: true));

        Assert.Contains("sequentially", error.Message);
        Assert.Equal(0, executor.InvocationCount);
    }

    [Fact]
    public async Task TurnAsync_RawFinalSkipsOutputGuardrail()
    {
        var rawResponse = new object();
        InvokerRegistry.RegisterExecutor(Provider, new QueueExecutor(rawResponse));
        var outputGuardrailCalled = false;
        var guardrails = new Guardrails(
            output: _ =>
            {
                outputGuardrailCalled = true;
                return new GuardrailResult(false, "raw output must not be inspected");
            });

        var result = await Pipeline.TurnAsync(NewAgent(), raw: true, guardrails: guardrails);

        Assert.Same(rawResponse, result);
        Assert.False(outputGuardrailCalled);
    }

    [Fact]
    public async Task TurnAsync_ProcessesAccumulatedStreamingItems_AndProjectsTokens()
    {
        var stream = new PromptyStream(StreamItems("one", "two"));
        InvokerRegistry.RegisterExecutor(Provider, new QueueExecutor(stream));
        InvokerRegistry.RegisterProcessor(Provider, new AccumulatedStreamProcessor());
        var tokens = new List<string>();
        EventCallback onEvent = (type, data) =>
        {
            if (type == AgentEventType.Token)
            {
                tokens.Add(data["token"]!.ToString()!);
            }
        };

        var result = await Pipeline.TurnAsync(NewAgent(), onEvent: onEvent);

        Assert.Equal("onetwo", result);
        Assert.Equal(["one", "two"], tokens);
        Assert.Equal(["one", "two"], stream.Items);
    }

    [Fact]
    public async Task TurnAsync_CancellationBetweenToolsCommitsFirstResultBeforeStopping()
    {
        var executor = new QueueExecutor(new ToolCallResult
        {
            ToolCalls =
            [
                new ToolCall { Id = "call-1", Name = "first", Arguments = "{}" },
                new ToolCall { Id = "call-2", Name = "second", Arguments = "{}" },
            ],
        });
        InvokerRegistry.RegisterExecutor(Provider, executor);
        using var cancellation = new CancellationTokenSource();
        var executed = new List<string>();
        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["first"] = _ =>
            {
                executed.Add("first");
                cancellation.Cancel();
                return Task.FromResult("first-result");
            },
            ["second"] = _ =>
            {
                executed.Add("second");
                return Task.FromResult("second-result");
            },
        };
        var agent = NewAgent();
        agent.Tools =
        [
            new FunctionTool { Name = "first", Kind = "function" },
            new FunctionTool { Name = "second", Kind = "function" },
        ];
        var toolResults = new List<string>();
        EventCallback onEvent = (type, data) =>
        {
            if (type == AgentEventType.ToolResult)
            {
                toolResults.Add(data["result"]!.ToString()!);
            }
        };

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Pipeline.TurnAsync(
                agent,
                tools: tools,
                onEvent: onEvent,
                cancellationToken: cancellation.Token));

        Assert.Equal(["first"], executed);
        Assert.Equal(["first-result"], toolResults);
    }

    [Fact]
    public async Task TurnAsync_CancellationAfterFinalToolCommitsConversationBeforeStopping()
    {
        var executor = new QueueExecutor(new ToolCallResult
        {
            ToolCalls = [new ToolCall { Id = "call-1", Name = "only", Arguments = "{}" }],
        });
        InvokerRegistry.RegisterExecutor(Provider, executor);
        using var cancellation = new CancellationTokenSource();
        var tools = new Dictionary<string, Func<string, Task<string>>>
        {
            ["only"] = _ =>
            {
                cancellation.Cancel();
                return Task.FromResult("only-result");
            },
        };
        var agent = NewAgent();
        agent.Tools = [new FunctionTool { Name = "only", Kind = "function" }];
        var events = new List<AgentEventType>();
        EventCallback onEvent = (type, _) => events.Add(type);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Pipeline.TurnAsync(
                agent,
                tools: tools,
                onEvent: onEvent,
                cancellationToken: cancellation.Token));

        Assert.Contains(AgentEventType.ToolResult, events);
        Assert.Contains(AgentEventType.MessagesUpdated, events);
        Assert.Contains(AgentEventType.Cancelled, events);
    }

    private static TurnEngineRequest NewRequest(string sessionId, string turnId) =>
        new(sessionId, turnId, [])
        {
            Inputs = new Dictionary<string, object?>(),
            MaxIterations = 3,
            MaxModelAttempts = 1,
        };

    private static Prompty NewAgent() => new()
    {
        Name = "live-turn-agent",
        Instructions = "hello",
        Model = new Model { Id = "test-model", Provider = Provider },
        Template = new Template
        {
            Format = new FormatConfig { Kind = Format },
            Parser = new ParserConfig { Kind = Format },
        },
    };

    private sealed class QueueExecutor(params object[] responses) : IExecutor
    {
        private readonly Queue<object> _responses = new(responses);

        public int InvocationCount { get; private set; }

        public Task<object> ExecuteAsync(Prompty agent, List<Message> messages)
        {
            InvocationCount++;
            return Task.FromResult(_responses.Dequeue());
        }

        public List<Message> FormatToolMessages(
            object rawResponse,
            List<ToolCall> toolCalls,
            List<string> toolResults,
            string? textContent = null)
        {
            var messages = new List<Message> { Message.Assistant(textContent ?? string.Empty) };
            messages.AddRange(toolCalls.Select((call, index) => Message.ToolResult(call.Id, toolResults[index])));
            return messages;
        }
    }

    private sealed class PassthroughRenderer : IRenderer
    {
        public Task<string> RenderAsync(Prompty agent, string template, Dictionary<string, object?> inputs) =>
            Task.FromResult(template);
    }

    private sealed class PassthroughParser : IParser
    {
        public Task<List<Message>> ParseAsync(
            Prompty agent,
            string rendered,
            Dictionary<string, object?>? context) =>
            Task.FromResult(new List<Message> { Message.User(rendered) });
    }

    private sealed class PassthroughProcessor : IProcessor
    {
        public Task<object> ProcessAsync(Prompty agent, object response) => Task.FromResult(response);
    }

    private sealed class AccumulatedStreamProcessor : IProcessor
    {
        public Task<object> ProcessAsync(Prompty agent, object response)
        {
            var stream = Assert.IsType<PromptyStream>(response);
            return Task.FromResult<object>(string.Concat(stream.Items.Cast<string>()));
        }
    }

    private static async IAsyncEnumerable<object> StreamItems(params object[] items)
    {
        foreach (var item in items)
        {
            await Task.Yield();
            yield return item;
        }
    }

    private sealed class AtomicRecordingDurability : IEngineDurabilityPort
    {
        public List<(IReadOnlyList<EngineEvent> Events, EngineCheckpoint Checkpoint)> AtomicAppends { get; } = [];

        public List<EngineEvent> StandaloneEvents { get; } = [];

        public EngineEventKind? FailAfter { get; set; }

        public Task AppendAsync(EngineEvent @event)
        {
            StandaloneEvents.Add(@event);
            return Task.CompletedTask;
        }

        public Task AppendWithCheckpointAsync(
            IReadOnlyList<EngineEvent> events,
            EngineCheckpoint checkpoint)
        {
            AtomicAppends.Add((events, checkpoint));
            if (FailAfter is not null && events.Any(@event => @event.Kind == FailAfter))
            {
                throw PortError.Configuration("simulated durability crash");
            }
            return Task.CompletedTask;
        }
    }
}

// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

/// <summary>Covers effect failures, recovery contracts, context composition, retry, and best-effort streaming.</summary>
public class TurnEngineFailureTests
{
    [Fact]
    public async Task StructuredToolOutput_IsSerializedAsJsonForTheModel()
    {
        var output = new Dictionary<string, object?>
        {
            ["ok"] = true,
            ["items"] = new List<object?> { 1, "two" },
        };
        var tools = new StructuredOutputToolPort(output);
        var model = new CapturingModelPort(
        [
            new ModelInvocationResponse
            {
                AssistantMessages = [Message.Assistant("Using a tool.")],
                ToolRequests = [new ModelToolRequest { Id = "call-json", Name = "json", Arguments = new Dictionary<string, object>() }],
            },
            new ModelInvocationResponse { Output = "done", AssistantMessages = [], ToolRequests = [] },
        ]);
        var engine = CreateEngine(model, tools);

        var result = await engine.RunAsync(NewRequest(), CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Success, result.Commit.Status);
        var toolMessage = Assert.Single(model.Requests[1].Context.Messages, message => message.Role == Role.Tool);
        var text = Assert.IsType<TextPart>(Assert.Single(toolMessage.Parts));
        Assert.Equal("""{"items":[1,"two"],"ok":true}""", text.Value);
    }

    [Fact]
    public async Task ContextPort_CanAddMessagesAndDecisions()
    {
        var model = new CapturingModelPort(
        [
            new ModelInvocationResponse { Output = "done", AssistantMessages = [], ToolRequests = [] },
        ]);
        var effects = CreateEffects(model, new EchoToolPort(), context: new AppendingContextPort());
        var engine = new TurnEngine(effects);

        var result = await engine.RunAsync(NewRequest(), CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Success, result.Commit.Status);
        var snapshot = Assert.Single(result.Snapshots!);
        Assert.Equal(2, snapshot.Messages.Count);
        Assert.Equal("candidate-1", Assert.Single(snapshot.Decisions!).CandidateId);
        Assert.Same(snapshot, Assert.Single(model.Requests).Context);
    }

    [Fact]
    public async Task InvalidContextSnapshot_CommitsContextErrorWithoutInvokingModel()
    {
        var model = new ThrowingModelPort();
        var effects = CreateEffects(model, new EchoToolPort(), context: new InvalidContextPort());
        var result = await new TurnEngine(effects).RunAsync(NewRequest(), CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Failed, result.Commit.Status);
        var output = Assert.IsType<Dictionary<string, object?>>(result.Commit.Output);
        Assert.Equal("context_error", output["errorKind"]);
    }

    [Fact]
    public async Task TransientModelFailure_RetriesTheSameSnapshot()
    {
        var model = new TransientModelPort();
        var retry = new RecordingRetryPort();
        var effects = CreateEffects(model, new EchoToolPort(), retry: retry);
        var result = await new TurnEngine(effects).RunAsync(NewRequest(), CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Success, result.Commit.Status);
        Assert.Equal(2, model.InvocationCount);
        Assert.Single(retry.Requests);
        Assert.Same(model.Snapshots[0], model.Snapshots[1]);
    }

    [Fact]
    public async Task AtomicDurabilityFailure_ThrowsRecoveryRequiredWithCheckpoint()
    {
        var durability = new FailingCheckpointDurabilityPort();
        var effects = CreateEffects(
            new CapturingModelPort(
            [
                new ModelInvocationResponse { Output = "provider committed", AssistantMessages = [], ToolRequests = [] },
            ]),
            new EchoToolPort(),
            durability: durability);
        var engine = new TurnEngine(effects);

        var error = await Assert.ThrowsAsync<TurnEngineRecoveryRequiredException>(
            () => engine.RunAsync(NewRequest(), CancellationToken.None));

        Assert.Equal("model response", error.Stage);
        Assert.True(error.Checkpoint.FinalOutputReady);
        Assert.Equal("provider committed", error.Checkpoint.PendingOutput);
        Assert.Empty(error.ToolResults);
        Assert.DoesNotContain(durability.Events, evt => evt.Kind == EngineEventKind.ModelInvocationCompleted);
    }

    [Fact]
    public async Task StreamFailure_DoesNotChangeSemanticExecution()
    {
        var model = new StreamingModelPort();
        var effects = CreateEffects(model, new EchoToolPort(), stream: new FailingStreamPort());
        var result = await new TurnEngine(effects).RunAsync(NewRequest(), CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Success, result.Commit.Status);
        Assert.Equal("done", result.Commit.Output);
    }

    [Fact]
    public async Task NonPortStreamFailure_DoesNotChangeSemanticExecution()
    {
        var model = new StreamingModelPort();
        var effects = CreateEffects(model, new EchoToolPort(), stream: new FailingStreamPort(usePortError: false));
        var result = await new TurnEngine(effects).RunAsync(NewRequest(), CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Success, result.Commit.Status);
        Assert.Equal("done", result.Commit.Output);
    }

    [Fact]
    public async Task PostCommitEffectId_UsesUtf8ByteLengths()
    {
        var postCommit = new RecordingPostCommitPort();
        var effects = new TurnEngineEffects
        {
            Model = new CapturingModelPort(
            [
                new ModelInvocationResponse { Output = "done", AssistantMessages = [], ToolRequests = [] },
            ]),
            Tools = new EchoToolPort(),
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = new RecordingDurabilityPort(),
            PostCommit = postCommit,
        };
        var request = new TurnEngineRequest("séssion", "türn", [Message.User("Hello")]) { MaxIterations = 10 };

        await new TurnEngine(effects).RunAsync(request, CancellationToken.None);

        Assert.Equal("post_commit:8:séssion:5:türn", Assert.Single(postCommit.Commits).EffectId);
    }

    private static TurnEngineRequest NewRequest() =>
        new("session-1", "turn-1", [Message.User("Hello")]) { MaxIterations = 10 };

    private static TurnEngine CreateEngine(IEngineModelPort model, IEngineToolPort tools) =>
        new(CreateEffects(model, tools));

    private static TurnEngineEffects CreateEffects(
        IEngineModelPort model,
        IEngineToolPort tools,
        IEngineContextPort? context = null,
        IEngineRetryPolicyPort? retry = null,
        IEngineDurabilityPort? durability = null,
        IEngineModelStreamPort? stream = null) =>
        new()
        {
            Model = model,
            Tools = tools,
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Context = context ?? new PassthroughEngineContextPort(),
            Retry = retry ?? new NoopRetryPolicyPort(),
            Durability = durability ?? new RecordingDurabilityPort(),
            Stream = stream ?? new NoopModelStreamPort(),
        };

    private sealed class StructuredOutputToolPort(object output) : IEngineToolPort
    {
        public Task<ModelToolResult> ExecuteAsync(ModelToolRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(new ModelToolResult
            {
                RequestId = request.Id,
                Name = request.Name,
                Outcome = ModelToolOutcome.Success,
                Output = output,
            });
    }

    private sealed class CapturingModelPort(IEnumerable<ModelInvocationResponse> responses) : IEngineModelPort
    {
        private readonly Queue<ModelInvocationResponse> _responses = new(responses);

        public List<ModelInvocationRequest> Requests { get; } = [];

        public Task<ModelInvocationResponse> InvokeAsync(
            ModelInvocationRequest request,
            CancellationToken cancellationToken,
            IEngineModelStreamPort stream)
        {
            Requests.Add(request);
            return Task.FromResult(_responses.Dequeue());
        }
    }

    private sealed class AppendingContextPort : IEngineContextPort
    {
        public Task<ModelInvocationContextSnapshot> PrepareAsync(ContextRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(new ModelInvocationContextSnapshot
            {
                Id = $"context:{request.InvocationId}",
                SessionId = request.SessionId,
                TurnId = request.TurnId,
                InvocationId = request.InvocationId,
                Iteration = request.Iteration,
                Messages = [.. request.Messages, Message.System("Recalled context")],
                Decisions =
                [
                    new InvocationContextDecision
                    {
                        CandidateId = "candidate-1",
                        Disposition = InvocationContextDisposition.Included,
                        Reason = "included by test context",
                    },
                ],
                StablePrefixMessages = request.StablePrefixMessages,
                ContextState = request.ContextState,
            });
    }

    private sealed class InvalidContextPort : IEngineContextPort
    {
        public Task<ModelInvocationContextSnapshot> PrepareAsync(ContextRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(new ModelInvocationContextSnapshot
            {
                Id = "wrong",
                SessionId = "wrong-session",
                TurnId = request.TurnId,
                InvocationId = request.InvocationId,
                Iteration = request.Iteration,
                Messages = request.Messages,
                Decisions = [],
                StablePrefixMessages = request.StablePrefixMessages,
                ContextState = request.ContextState,
            });
    }

    private sealed class TransientModelPort : IEngineModelPort
    {
        public int InvocationCount { get; private set; }

        public List<ModelInvocationContextSnapshot> Snapshots { get; } = [];

        public Task<ModelInvocationResponse> InvokeAsync(
            ModelInvocationRequest request,
            CancellationToken cancellationToken,
            IEngineModelStreamPort stream)
        {
            InvocationCount++;
            Snapshots.Add(request.Context);
            return InvocationCount == 1
                ? throw new PortError("transient")
                : Task.FromResult(new ModelInvocationResponse { Output = "done", AssistantMessages = [], ToolRequests = [] });
        }
    }

    private sealed class RecordingRetryPort : IEngineRetryPolicyPort
    {
        public List<RetryPolicyRequest> Requests { get; } = [];

        public Task BackoffAsync(RetryPolicyRequest request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return Task.CompletedTask;
        }
    }

    private sealed class FailingCheckpointDurabilityPort : IEngineDurabilityPort
    {
        public List<EngineEvent> Events { get; } = [];

        public Task AppendAsync(EngineEvent @event)
        {
            Events.Add(@event);
            return Task.CompletedTask;
        }

        public Task AppendWithCheckpointAsync(IReadOnlyList<EngineEvent> events, EngineCheckpoint checkpoint) =>
            throw new PortError("atomic store unavailable");
    }

    private sealed class StreamingModelPort : IEngineModelPort
    {
        public async Task<ModelInvocationResponse> InvokeAsync(
            ModelInvocationRequest request,
            CancellationToken cancellationToken,
            IEngineModelStreamPort stream)
        {
            await stream.EmitAsync(new ModelStreamChunk.Text("partial"));
            return new ModelInvocationResponse { Output = "done", AssistantMessages = [], ToolRequests = [] };
        }
    }

    private sealed class FailingStreamPort(bool usePortError = true) : IEngineModelStreamPort
    {
        public Task EmitAsync(ModelStreamChunk chunk) =>
            usePortError
                ? throw new PortError("stream sink unavailable")
                : throw new IOException("stream sink unavailable");
    }
}

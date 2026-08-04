// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

/// <summary>
/// Covers behavior that the shared vectors do not exercise directly: indeterminate tool-effect
/// and model-effect reconciliation (an effect whose real-world outcome is unknown must block the
/// turn until a host supplies an explicit determinate resolution, and resuming must never re-run
/// the unknown effect), non-fatal post-commit failures, mid-run cancellation, and strictly
/// sequential (never concurrent) tool execution.
/// </summary>
public class TurnEngineReconciliationTests
{
    [Fact]
    public async Task IndeterminateToolEffect_BlocksTurnUntilExplicitReconciliation()
    {
        var toolRequest = new ModelToolRequest { Id = "call-a", Name = "echo", Arguments = new Dictionary<string, object> { ["value"] = "A" } };
        var steps = new List<ScriptedModelStep> { new() { Assistant = "Using a tool.", Tools = [toolRequest] } };

        var durability = new RecordingDurabilityPort();
        var effects = new TurnEngineEffects
        {
            Model = new ScriptedModelPort(steps),
            Tools = new IndeterminateToolPort("call-a", new EchoToolPort()),
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = durability,
        };

        var engine = new TurnEngine(effects);
        var request = new TurnEngineRequest("session-1", "turn-1", [Message.User("Do something")]) { MaxIterations = 10 };
        var result = await engine.RunAsync(request, CancellationToken.None);

        Assert.Equal(EngineTurnStatus.ReconciliationRequired, result.Commit.Status);

        var checkpoint = durability.Checkpoints.Last();
        Assert.True(checkpoint.ReconciliationRequired);
        Assert.Equal(ModelToolOutcome.Indeterminate, checkpoint.CompletedToolResults!.Single().Outcome);
        Assert.Null(checkpoint.ModelReconciliation);

        // Resuming without an explicit resolution must not silently proceed or re-run the tool —
        // it re-reports the same reconciliation-required outcome.
        var unresolvedTools = new EchoToolPort(forbiddenRequestIds: ["call-a"]);
        var unresolvedEngine = new TurnEngine(new TurnEngineEffects
        {
            Model = new ThrowingModelPort(),
            Tools = unresolvedTools,
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = new RecordingDurabilityPort(),
        });
        var unresolvedResume = TurnEngineRequest.ResumeFrom(checkpoint, maxIterations: 10, lastJournalSequence: 0);
        var unresolvedResult = await unresolvedEngine.RunAsync(unresolvedResume, CancellationToken.None);
        Assert.Equal(EngineTurnStatus.ReconciliationRequired, unresolvedResult.Commit.Status);
        Assert.Empty(unresolvedTools.ExecutedRequestIds);

        // Attempting to resolve with another indeterminate outcome is rejected outright.
        var stillIndeterminate = new ModelToolResult { RequestId = "call-a", Name = "echo", Outcome = ModelToolOutcome.Indeterminate, Output = "still unknown" };
        Assert.Throws<TurnEngineInvalidRequestException>(() =>
            TurnEngineRequest.ResumeAfterReconciliation(checkpoint, 10, 0, stillIndeterminate));

        // Resolving with an explicit determinate outcome resumes and completes without re-running
        // the tool at all.
        var resolvedResult = new ModelToolResult { RequestId = "call-a", Name = "echo", Outcome = ModelToolOutcome.Success, Output = "A" };
        var resolvedTools = new EchoToolPort(forbiddenRequestIds: ["call-a"]);
        var resolvedEngine = new TurnEngine(new TurnEngineEffects
        {
            Model = new ScriptedModelPort([new ScriptedModelStep { Output = "done" }]),
            Tools = resolvedTools,
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = new RecordingDurabilityPort(),
        });
        var resolvedRequest = TurnEngineRequest.ResumeAfterReconciliation(checkpoint, 10, 0, resolvedResult);
        var finalResult = await resolvedEngine.RunAsync(resolvedRequest, CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Success, finalResult.Commit.Status);
        Assert.Equal("done", finalResult.Commit.Output);
        Assert.Empty(resolvedTools.ExecutedRequestIds);
        Assert.Equal(ModelToolOutcome.Success, finalResult.ToolResults!.Single(t => t.RequestId == "call-a").Outcome);
    }

    [Fact]
    public async Task IndeterminateModelEffect_BlocksTurnUntilExplicitReconciliation()
    {
        var durability = new RecordingDurabilityPort();
        var effects = new TurnEngineEffects
        {
            Model = new IndeterminateModelPort(),
            Tools = new EchoToolPort(),
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = durability,
        };

        var engine = new TurnEngine(effects);
        // A single model attempt is enough to force reconciliation: an indeterminate outcome is
        // never retried, regardless of MaxModelAttempts.
        var request = new TurnEngineRequest("session-1", "turn-1", [Message.User("Hello")]) { MaxIterations = 10, MaxModelAttempts = 3 };
        var result = await engine.RunAsync(request, CancellationToken.None);

        Assert.Equal(EngineTurnStatus.ReconciliationRequired, result.Commit.Status);
        Assert.Equal(1, ((IndeterminateModelPort)effects.Model).InvocationCount);

        var checkpoint = durability.Checkpoints.Last();
        Assert.True(checkpoint.ReconciliationRequired);
        Assert.NotNull(checkpoint.ModelReconciliation);
        Assert.Equal(checkpoint.ActiveInvocationId, checkpoint.ModelReconciliation!.InvocationId);

        // Resolving with an explicit model response resumes without re-invoking the model port.
        var resolvedResponse = new ModelInvocationResponse { Output = "resolved output", AssistantMessages = [], ToolRequests = [] };
        var resumedEngine = new TurnEngine(new TurnEngineEffects
        {
            Model = new ThrowingModelPort(),
            Tools = new EchoToolPort(),
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = new RecordingDurabilityPort(),
        });
        var resumeRequest = TurnEngineRequest.ResumeAfterModelReconciliation(checkpoint, 10, 0, resolvedResponse);
        var resumedResult = await resumedEngine.RunAsync(resumeRequest, CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Success, resumedResult.Commit.Status);
        Assert.Equal("resolved output", resumedResult.Commit.Output);
    }

    [Fact]
    public async Task PostCommitFailure_IsReportedNonFatally()
    {
        var postCommit = new FailingPostCommitPort();
        var effects = new TurnEngineEffects
        {
            Model = new ScriptedModelPort([new ScriptedModelStep { Output = "Hello back" }]),
            Tools = new EchoToolPort(),
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = new RecordingDurabilityPort(),
            PostCommit = postCommit,
        };

        var engine = new TurnEngine(effects);
        var request = new TurnEngineRequest("session-1", "turn-1", [Message.User("Hello")]) { MaxIterations = 10 };
        var result = await engine.RunAsync(request, CancellationToken.None);

        // The turn itself still committed successfully — a broken post-commit sink never
        // uncommits the turn — but the failure is surfaced for the host to notice and retry.
        Assert.Equal(EngineTurnStatus.Success, result.Commit.Status);
        Assert.Equal("Hello back", result.Commit.Output);
        Assert.NotNull(result.PostCommitError);
        Assert.Contains(FailingPostCommitPort.FailureMessage, result.PostCommitError);
        Assert.Single(postCommit.AttemptedEffectIds);
    }

    [Fact]
    public async Task Cancellation_BetweenSequentialTools_StopsBeforeTheSecondToolRuns()
    {
        var toolA = new ModelToolRequest { Id = "call-a", Name = "echo", Arguments = new Dictionary<string, object> { ["value"] = "A" } };
        var toolB = new ModelToolRequest { Id = "call-b", Name = "echo", Arguments = new Dictionary<string, object> { ["value"] = "B" } };
        var steps = new List<ScriptedModelStep>
        {
            new() { Assistant = "Using tools.", Tools = [toolA, toolB] },
            new() { Output = "should never be reached" },
        };

        using var cts = new CancellationTokenSource();
        var tools = new CancelAfterFirstToolPort(cts, "call-a");
        var durability = new RecordingDurabilityPort();
        var effects = new TurnEngineEffects
        {
            Model = new ScriptedModelPort(steps),
            Tools = tools,
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = durability,
        };

        var engine = new TurnEngine(effects);
        var request = new TurnEngineRequest("session-1", "turn-1", [Message.User("Add two values")]) { MaxIterations = 10 };
        var result = await engine.RunAsync(request, cts.Token);

        Assert.Equal(EngineTurnStatus.Cancelled, result.Commit.Status);
        Assert.Equal(["call-a"], tools.ExecutedRequestIds);
        Assert.Single(result.ToolResults!);
        Assert.Equal(EngineEventKind.TurnCancelled, durability.Events.Last().Kind);
    }

    [Fact]
    public async Task Tools_ExecuteStrictlySequentially_NeverConcurrently()
    {
        var toolA = new ModelToolRequest { Id = "call-a", Name = "echo", Arguments = new Dictionary<string, object> { ["value"] = "A" } };
        var toolB = new ModelToolRequest { Id = "call-b", Name = "echo", Arguments = new Dictionary<string, object> { ["value"] = "B" } };
        var steps = new List<ScriptedModelStep>
        {
            new() { Assistant = "Using tools.", Tools = [toolA, toolB] },
            new() { Output = "A then B" },
        };
        var tools = new EchoToolPort(new Dictionary<string, string> { ["call-a"] = "A", ["call-b"] = "B" });
        var effects = new TurnEngineEffects
        {
            Model = new ScriptedModelPort(steps),
            Tools = tools,
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = new RecordingDurabilityPort(),
        };

        var engine = new TurnEngine(effects);
        var request = new TurnEngineRequest("session-1", "turn-1", [Message.User("Add two values")]) { MaxIterations = 10 };
        var result = await engine.RunAsync(request, CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Success, result.Commit.Status);
        Assert.Equal(1, tools.MaxObservedConcurrency);
        Assert.Equal(["call-a", "call-b"], tools.ExecutedRequestIds);
    }

    /// <summary>Tool port that cancels the shared token immediately after its first configured request completes.</summary>
    private sealed class CancelAfterFirstToolPort(CancellationTokenSource cancellationSource, string cancelAfterRequestId) : IEngineToolPort
    {
        public List<string> ExecutedRequestIds { get; } = [];

        public Task<ModelToolResult> ExecuteAsync(ModelToolRequest request, CancellationToken cancellationToken)
        {
            if (ExecutedRequestIds.Contains(cancelAfterRequestId))
            {
                throw new InvalidOperationException($"tool '{request.Id}' must not execute after cancellation");
            }

            ExecutedRequestIds.Add(request.Id);
            var result = new ModelToolResult { RequestId = request.Id, Name = request.Name, Outcome = ModelToolOutcome.Success, Output = request.Id };
            if (request.Id == cancelAfterRequestId)
            {
                cancellationSource.Cancel();
            }

            return Task.FromResult(result);
        }
    }
}

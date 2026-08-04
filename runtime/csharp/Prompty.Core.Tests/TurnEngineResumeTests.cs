// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

/// <summary>
/// Proves the canonical <see cref="TurnEngine"/> can resume from a durably persisted
/// <see cref="EngineCheckpoint"/> without duplicating already-committed effects: a checkpoint
/// captured right after the first of two sequential tool results resumes without re-running
/// that tool, continues the event sequence after the checkpoint's last committed sequence
/// (or the journal tail, whichever is larger), a checkpoint with a ready final output commits
/// without ever re-invoking the model, and a checkpoint resumed with no iteration budget left
/// fails immediately instead of silently looping.
/// </summary>
public class TurnEngineResumeTests
{
    /// <summary>
    /// Runs the two-sequential-tool scenario (mirrors the "ordered_tool_round" shared vector)
    /// to completion while recording every checkpoint the engine persists along the way, so
    /// individual tests can resume from any mid-run checkpoint.
    /// </summary>
    private static async Task<(RecordingDurabilityPort Durability, TurnEngineResult Result)> RunOrderedToolRoundAsync()
    {
        var steps = new List<ScriptedModelStep>
        {
            new()
            {
                Assistant = "I will use the tools.",
                Tools =
                [
                    new ModelToolRequest { Id = "call-a", Name = "echo", Arguments = new Dictionary<string, object> { ["value"] = "A" } },
                    new ModelToolRequest { Id = "call-b", Name = "echo", Arguments = new Dictionary<string, object> { ["value"] = "B" } },
                ],
            },
            new() { Output = "A then B" },
        };
        var toolOutputs = new Dictionary<string, string> { ["call-a"] = "A", ["call-b"] = "B" };

        var durability = new RecordingDurabilityPort();
        var effects = new TurnEngineEffects
        {
            Model = new ScriptedModelPort(steps),
            Tools = new EchoToolPort(toolOutputs),
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = durability,
        };

        var engine = new TurnEngine(effects);
        var request = new TurnEngineRequest("session-1", "turn-1", [Message.User("Add two values")]) { MaxIterations = 10 };
        var result = await engine.RunAsync(request, CancellationToken.None);
        return (durability, result);
    }

    [Fact]
    public async Task Resume_AfterFirstToolResult_DoesNotRerunThatTool()
    {
        var (durability, originalResult) = await RunOrderedToolRoundAsync();
        Assert.Equal(EngineTurnStatus.Success, originalResult.Commit.Status);

        // The checkpoint persisted immediately after "call-a" completes: exactly one completed
        // tool result, and "call-b" still pending.
        var checkpointAfterFirstTool = durability.Checkpoints.First(c =>
            (c.CompletedToolResults?.Count ?? 0) == 1
            && (c.PendingToolRequests?.Count ?? 0) == 1);

        Assert.Equal("call-a", checkpointAfterFirstTool.CompletedToolResults![0].RequestId);
        Assert.Equal("call-b", checkpointAfterFirstTool.PendingToolRequests![0].Id);

        // Resume with a tool port that throws if "call-a" is ever asked to execute again, and a
        // model port that only knows about the final output step (the tool round's own model
        // response is already durably captured in the checkpoint and must not be re-requested).
        var resumedDurability = new RecordingDurabilityPort();
        var resumedTools = new EchoToolPort(
            new Dictionary<string, string> { ["call-b"] = "B" },
            forbiddenRequestIds: ["call-a"]);
        var resumedEffects = new TurnEngineEffects
        {
            Model = new ScriptedModelPort([new ScriptedModelStep { Output = "A then B" }]),
            Tools = resumedTools,
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = resumedDurability,
        };

        var resumedEngine = new TurnEngine(resumedEffects);
        var resumeRequest = TurnEngineRequest.ResumeFrom(checkpointAfterFirstTool, maxIterations: 10, lastJournalSequence: 0);
        var resumedResult = await resumedEngine.RunAsync(resumeRequest, CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Success, resumedResult.Commit.Status);
        Assert.Equal("A then B", resumedResult.Commit.Output);
        Assert.Equal(["call-b"], resumedTools.ExecutedRequestIds);
        Assert.Equal(2, resumedResult.ToolResults?.Count);
        Assert.Equal(["call-a", "call-b"], resumedResult.ToolResults!.Select(t => t.RequestId));

        // The resumed run must continue the event sequence strictly after the checkpoint's last
        // committed sequence — never restart from 1, which would duplicate already-durable events.
        Assert.All(resumedDurability.Events, e => Assert.True(e.Sequence > checkpointAfterFirstTool.LastSequence));
        Assert.Equal(checkpointAfterFirstTool.LastSequence + 1, resumedDurability.Events[0].Sequence);
    }

    [Fact]
    public async Task Resume_ContinuesAfterMaxOfCheckpointAndJournalTail()
    {
        var (durability, _) = await RunOrderedToolRoundAsync();
        var checkpointAfterFirstTool = durability.Checkpoints.First(c =>
            (c.CompletedToolResults?.Count ?? 0) == 1 && (c.PendingToolRequests?.Count ?? 0) == 1);

        // Simulate a journal whose tail is further ahead than the checkpoint itself (for example,
        // a plain, non-checkpointed event was appended after the checkpoint before the host
        // crashed). Resuming must continue after the larger of the two, never the checkpoint alone.
        var journalTail = checkpointAfterFirstTool.LastSequence + 5;

        var resumedDurability = new RecordingDurabilityPort();
        var resumedEffects = new TurnEngineEffects
        {
            Model = new ScriptedModelPort([new ScriptedModelStep { Output = "A then B" }]),
            Tools = new EchoToolPort(new Dictionary<string, string> { ["call-b"] = "B" }, forbiddenRequestIds: ["call-a"]),
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = resumedDurability,
        };

        var resumedEngine = new TurnEngine(resumedEffects);
        var resumeRequest = TurnEngineRequest.ResumeFrom(checkpointAfterFirstTool, maxIterations: 10, lastJournalSequence: journalTail);
        Assert.Equal(journalTail, resumeRequest.InitialSequence);

        var resumedResult = await resumedEngine.RunAsync(resumeRequest, CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Success, resumedResult.Commit.Status);
        Assert.Equal(journalTail + 1, resumedDurability.Events[0].Sequence);
    }

    [Fact]
    public async Task Resume_WhenFinalOutputAlreadyReady_NeverReinvokesModel()
    {
        var (durability, _) = await RunOrderedToolRoundAsync();
        var finalCheckpoint = durability.Checkpoints.Last(c => c.FinalOutputReady);

        var resumedEffects = new TurnEngineEffects
        {
            Model = new ThrowingModelPort(),
            Tools = new EchoToolPort(forbiddenRequestIds: ["call-a", "call-b"]),
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = new RecordingDurabilityPort(),
        };

        var resumedEngine = new TurnEngine(resumedEffects);
        var resumeRequest = TurnEngineRequest.ResumeFrom(finalCheckpoint, maxIterations: 10, lastJournalSequence: 0);
        var resumedResult = await resumedEngine.RunAsync(resumeRequest, CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Success, resumedResult.Commit.Status);
        Assert.Equal("A then B", resumedResult.Commit.Output);
    }

    [Fact]
    public async Task Resume_WithNoIterationBudgetRemaining_FailsWithMaxIterations()
    {
        var (durability, _) = await RunOrderedToolRoundAsync();
        var checkpointAfterFirstTool = durability.Checkpoints.First(c =>
            (c.CompletedToolResults?.Count ?? 0) == 1 && (c.PendingToolRequests?.Count ?? 0) == 1);

        var resumedEffects = new TurnEngineEffects
        {
            Model = new ThrowingModelPort(),
            Tools = new EchoToolPort(forbiddenRequestIds: ["call-a", "call-b"]),
            Clock = new FakeEngineClock(),
            Ids = new FakeEngineIdGenerator(),
            Durability = new RecordingDurabilityPort(),
        };

        var resumedEngine = new TurnEngine(resumedEffects);
        // maxIterations equal to the checkpoint's own iteration means the resumed run starts
        // with no budget left at all: the while loop condition is false on the first check.
        var resumeRequest = TurnEngineRequest.ResumeFrom(
            checkpointAfterFirstTool,
            maxIterations: checkpointAfterFirstTool.Iteration,
            lastJournalSequence: 0);
        var resumedResult = await resumedEngine.RunAsync(resumeRequest, CancellationToken.None);

        Assert.Equal(EngineTurnStatus.Failed, resumedResult.Commit.Status);
        var output = Assert.IsType<Dictionary<string, object?>>(resumedResult.Commit.Output);
        Assert.Equal("max_iterations", output["errorKind"]);
    }
}

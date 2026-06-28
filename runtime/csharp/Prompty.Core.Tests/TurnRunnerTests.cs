// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using Prompty.Core;

namespace Prompty.Core.Tests;

public class TurnRunnerTests
{
    [Fact]
    public async Task ReferenceTurnRunner_EmitsJournalsAndCheckpoints()
    {
        var directory = Directory.CreateTempSubdirectory("prompty-turn-");
        try
        {
            var journalPath = Path.Combine(directory.FullName, "trace.jsonl");
            var sink = new CollectingEventSink();
            var checkpointStore = new InMemoryCheckpointStore();
            var runner = new ReferenceTurnRunner(
                sink,
                new JsonlEventJournalWriter(journalPath),
                checkpointStore,
                new AllowAllPermissionResolver(),
                new FunctionHostToolExecutor(new Dictionary<string, HostToolHandler>()),
                request => Task.FromResult(new TurnModelResponse
                {
                    Output = new Dictionary<string, object> { ["text"] = $"hello {request.Inputs["name"]}" },
                    CheckpointState = new Dictionary<string, object> { ["stable"] = true }
                }),
                FixedClock(),
                FixedIds());

            var result = await runner.RunAsync(new RunTurnRequest
            {
                SessionId = "session-1",
                TurnId = "turn-1",
                Inputs = new Dictionary<string, object> { ["name"] = "Ada" },
                Options = new TurnOptions { MaxIterations = 3 }
            });

            Assert.Equal("success", result.Status);
            Assert.Equal(1, result.Iterations);
            Assert.Equal("hello Ada", Assert.IsType<Dictionary<string, object>>(result.Output)["text"]);
            Assert.Equal(
                [TurnEventType.TurnStart, TurnEventType.LlmStart, TurnEventType.LlmComplete, TurnEventType.TurnEnd],
                sink.TurnEvents.Select(turnEvent => turnEvent.Type).ToArray());
            Assert.Equal(
                [SessionEventType.SessionStart, SessionEventType.CheckpointCreated, SessionEventType.SessionEnd],
                sink.SessionEvents.Select(sessionEvent => sessionEvent.Type).ToArray());
            var checkpoint = await checkpointStore.LoadAsync("session-1", "turn-1-checkpoint-0");
            Assert.NotNull(checkpoint);
            Assert.True((bool)checkpoint.State!["stable"]);
            Assert.Equal(
                ["session", "turn", "turn", "turn", "session", "turn", "session", "summary"],
                JournalKinds(journalPath));
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }

    [Fact]
    public async Task ReferenceTurnRunner_ExecutesHostTools()
    {
        var directory = Directory.CreateTempSubdirectory("prompty-turn-tool-");
        try
        {
            var sink = new CollectingEventSink();
            var runner = new ReferenceTurnRunner(
                sink,
                new JsonlEventJournalWriter(Path.Combine(directory.FullName, "trace.jsonl")),
                new InMemoryCheckpointStore(),
                new AllowAllPermissionResolver(),
                new FunctionHostToolExecutor(new Dictionary<string, HostToolHandler>
                {
                    ["add"] = (args, _) => Task.FromResult<object?>(Convert.ToInt32(args["a"]) + Convert.ToInt32(args["b"]))
                }),
                request =>
                {
                    if (request.Iteration == 0)
                    {
                        return Task.FromResult(new TurnModelResponse
                        {
                            ToolRequests =
                            [
                                new HostToolRequest
                                {
                                    RequestId = "exec-1",
                                    ToolCallId = "call-1",
                                    ToolName = "add",
                                    Arguments = new Dictionary<string, object> { ["a"] = 2, ["b"] = 3 }
                                }
                            ]
                        });
                    }

                    return Task.FromResult(new TurnModelResponse
                    {
                        Output = new Dictionary<string, object?> { ["toolResult"] = request.ToolResults[0].Result }
                    });
                },
                FixedClock(),
                FixedIds());

            var result = await runner.RunAsync(new RunTurnRequest { SessionId = "session-1", TurnId = "turn-1" });

            Assert.Equal(5, Assert.IsType<Dictionary<string, object?>>(result.Output)["toolResult"]);
            Assert.True(result.ToolResults[0].Success);
            Assert.Equal(
                [
                    TurnEventType.TurnStart,
                    TurnEventType.LlmStart,
                    TurnEventType.LlmComplete,
                    TurnEventType.PermissionRequested,
                    TurnEventType.PermissionCompleted,
                    TurnEventType.ToolExecutionStart,
                    TurnEventType.ToolExecutionComplete,
                    TurnEventType.ToolResult,
                    TurnEventType.MessagesUpdated,
                    TurnEventType.LlmStart,
                    TurnEventType.LlmComplete,
                    TurnEventType.TurnEnd
                ],
                sink.TurnEvents.Select(turnEvent => turnEvent.Type).ToArray());
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }

    [Fact]
    public async Task ReferenceTurnRunner_DeniedPermissionSkipsExecution()
    {
        var directory = Directory.CreateTempSubdirectory("prompty-turn-deny-");
        try
        {
            var sink = new CollectingEventSink();
            var runner = new ReferenceTurnRunner(
                sink,
                new JsonlEventJournalWriter(Path.Combine(directory.FullName, "trace.jsonl")),
                new InMemoryCheckpointStore(),
                new DenyAllPermissionResolver(),
                new FunctionHostToolExecutor(new Dictionary<string, HostToolHandler>
                {
                    ["shell"] = (_, _) => throw new InvalidOperationException("should not execute")
                }),
                request =>
                {
                    if (request.Iteration == 0)
                    {
                        return Task.FromResult(new TurnModelResponse
                        {
                            ToolRequests = [new HostToolRequest { RequestId = "exec-1", ToolName = "shell" }]
                        });
                    }

                    return Task.FromResult(new TurnModelResponse
                    {
                        Output = new Dictionary<string, object?> { ["denied"] = request.ToolResults[0].ErrorKind }
                    });
                },
                FixedClock(),
                FixedIds());

            var result = await runner.RunAsync(new RunTurnRequest { SessionId = "session-1", TurnId = "turn-1" });

            Assert.Equal("permission_denied", Assert.IsType<Dictionary<string, object?>>(result.Output)["denied"]);
            Assert.DoesNotContain(sink.TurnEvents, turnEvent => turnEvent.Type == TurnEventType.ToolExecutionStart);
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }

    [Fact]
    public async Task ReferenceTurnRunner_HostToolFailureIsReplayable()
    {
        var directory = Directory.CreateTempSubdirectory("prompty-turn-fail-");
        try
        {
            var runner = new ReferenceTurnRunner(
                new CollectingEventSink(),
                new JsonlEventJournalWriter(Path.Combine(directory.FullName, "trace.jsonl")),
                new InMemoryCheckpointStore(),
                new AllowAllPermissionResolver(),
                new FunctionHostToolExecutor(new Dictionary<string, HostToolHandler>
                {
                    ["fail"] = (_, _) => throw new InvalidOperationException("boom")
                }),
                request =>
                {
                    if (request.Iteration == 0)
                    {
                        return Task.FromResult(new TurnModelResponse
                        {
                            ToolRequests = [new HostToolRequest { RequestId = "exec-1", ToolName = "fail" }]
                        });
                    }

                    return Task.FromResult(new TurnModelResponse { Output = request.ToolResults[0].Save() });
                },
                FixedClock(),
                FixedIds());

            var result = await runner.RunAsync(new RunTurnRequest { SessionId = "session-1", TurnId = "turn-1" });

            var output = Assert.IsType<Dictionary<string, object?>>(result.Output);
            Assert.Equal(false, output["success"]);
            Assert.Equal("exception", output["errorKind"]);
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }

    [Fact]
    public async Task ReferenceTurnRunner_DeterministicJournal()
    {
        var directory = Directory.CreateTempSubdirectory("prompty-turn-deterministic-");
        try
        {
            async Task<string> RunOnce(string path)
            {
                var runner = new ReferenceTurnRunner(
                    new CollectingEventSink(),
                    new JsonlEventJournalWriter(path),
                    new InMemoryCheckpointStore(),
                    new AllowAllPermissionResolver(),
                    new FunctionHostToolExecutor(new Dictionary<string, HostToolHandler>()),
                    _ => Task.FromResult(new TurnModelResponse { Output = "done" }),
                    FixedClock(),
                    FixedIds());
                await runner.RunAsync(new RunTurnRequest { SessionId = "session-1", TurnId = "turn-1" });
                return File.ReadAllText(path);
            }

            Assert.Equal(
                await RunOnce(Path.Combine(directory.FullName, "first.jsonl")),
                await RunOnce(Path.Combine(directory.FullName, "second.jsonl")));
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }

    private static Func<string> FixedClock() => () => "2026-06-28T00:00:00Z";

    private static Func<string, string> FixedIds()
    {
        var index = 0;
        return prefix => $"{prefix}-{++index}";
    }

    private static string[] JournalKinds(string path)
    {
        return File.ReadAllLines(path)
            .Select(line => JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(line)!)
            .Select(record => record["kind"].GetString()!)
            .ToArray();
    }
}

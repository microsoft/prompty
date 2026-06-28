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

            Assert.Equal(RunTurnStatus.Success, result.Status);
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

    [Fact]
    public async Task ReferenceTurnRunner_MatchesSharedGoldenReplayVectors()
    {
        var vectors = ReplayVectors.Load();

        foreach (var scenario in vectors.Scenarios)
        {
            var directory = Directory.CreateTempSubdirectory($"prompty-replay-{scenario.Name}-");
            try
            {
                var journalPath = Path.Combine(directory.FullName, "trace.jsonl");
                var runner = new ReferenceTurnRunner(
                    new CollectingEventSink(),
                    new JsonlEventJournalWriter(journalPath),
                    new InMemoryCheckpointStore(),
                    scenario.Name == "permission_denied" ? new DenyAllPermissionResolver() : new AllowAllPermissionResolver(),
                    new FunctionHostToolExecutor(new Dictionary<string, HostToolHandler>
                    {
                        ["add"] = (args, _) => Task.FromResult<object?>(Convert.ToInt32(args["a"]) + Convert.ToInt32(args["b"])),
                        ["fail"] = (_, _) => throw new InvalidOperationException("boom")
                    }),
                    ModelForScenario(scenario.Name),
                    () => vectors.Clock,
                    FixedIds());

                await runner.RunAsync(new RunTurnRequest
                {
                    SessionId = vectors.SessionId,
                    TurnId = vectors.TurnId,
                    Inputs = scenario.Inputs ?? new Dictionary<string, object>(),
                    Options = new TurnOptions { MaxIterations = scenario.MaxIterations }
                });

                Assert.Equal(scenario.Expected, NormalizeJournal(journalPath));
            }
            finally
            {
                directory.Delete(recursive: true);
            }
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

    private static Func<TurnModelRequest, Task<TurnModelResponse>> ModelForScenario(string name)
    {
        return request =>
        {
            if (name == "no_tool")
            {
                return Task.FromResult(new TurnModelResponse
                {
                    Output = new Dictionary<string, object> { ["text"] = $"hello {request.Inputs["name"]}" },
                    CheckpointState = new Dictionary<string, object> { ["stable"] = true }
                });
            }

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
                            ToolName = name == "tool_failure" ? "fail" : "add",
                            Arguments = new Dictionary<string, object> { ["a"] = 2, ["b"] = 3 }
                        }
                    ]
                });
            }

            return Task.FromResult(new TurnModelResponse
            {
                Output = new Dictionary<string, object?>
                {
                    ["toolResult"] = request.ToolResults[0].Result,
                    ["errorKind"] = request.ToolResults[0].ErrorKind
                }
            });
        };
    }

    private static string[] NormalizeJournal(string path)
    {
        return File.ReadAllLines(path)
            .Select(line => JsonSerializer.Deserialize<JsonElement>(line))
            .Select(NormalizeRecord)
            .ToArray();
    }

    private static string NormalizeRecord(JsonElement record)
    {
        if (record.GetProperty("kind").GetString() == "summary")
        {
            var summary = record.GetProperty("summary");
            return $"summary:{summary.GetProperty("sessionId").GetString()}:{NormalizeStatus(summary.GetProperty("status"))}:turns={summary.GetProperty("turns").GetInt32()}:checkpoints={summary.GetProperty("checkpoints").GetInt32()}";
        }

        var eventElement = record.GetProperty("event");
        var type = eventElement.GetProperty("type").GetString()!;
        if (record.GetProperty("kind").GetString() == "session")
        {
            if (type == "session_end")
            {
                return $"session:{type}:{eventElement.GetProperty("sessionId").GetString()}:{eventElement.GetProperty("turnId").GetString()}:{NormalizeStatus(eventElement.GetProperty("payload").GetProperty("status"))}";
            }

            return $"session:{type}:{eventElement.GetProperty("sessionId").GetString()}:{eventElement.GetProperty("turnId").GetString()}";
        }

        var iteration = eventElement.GetProperty("iteration").GetInt32();
        var payload = eventElement.GetProperty("payload");
        return type switch
        {
            "permission_requested" => $"turn:{type}:{iteration}:{payload.GetProperty("requestId").GetString()}",
            "permission_completed" => $"turn:{type}:{iteration}:{payload.GetProperty("approved").GetBoolean().ToString().ToLowerInvariant()}",
            "tool_execution_start" => $"turn:{type}:{iteration}:{payload.GetProperty("toolName").GetString()}",
            "tool_execution_complete" or "tool_result" => NormalizeToolResult(type, iteration, payload),
            "error" => $"turn:{type}:{iteration}:{payload.GetProperty("errorKind").GetString()}",
            "turn_end" => $"turn:{type}:{iteration}:{NormalizeStatus(payload.GetProperty("status"))}",
            _ => $"turn:{type}:{iteration}"
        };
    }

    private static string NormalizeToolResult(string type, int iteration, JsonElement payload)
    {
        var value = $"turn:{type}:{iteration}:{payload.GetProperty("toolName").GetString()}:{payload.GetProperty("success").GetBoolean().ToString().ToLowerInvariant()}";
        return payload.TryGetProperty("errorKind", out var errorKind) && errorKind.ValueKind != JsonValueKind.Null
            ? $"{value}:{errorKind.GetString()}"
            : value;
    }

    private static string NormalizeStatus(JsonElement value)
    {
        return value.ValueKind == JsonValueKind.String
            ? value.GetString()!.ToLowerInvariant()
            : value.ToString().ToLowerInvariant();
    }

    private sealed record ReplayVectors(
        int Version,
        string Clock,
        string SessionId,
        string TurnId,
        IReadOnlyList<ReplayScenario> Scenarios)
    {
        public static ReplayVectors Load()
        {
            var path = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", "spec", "vectors", "harness", "replay_vectors.json"));
            var document = JsonDocument.Parse(File.ReadAllText(path));
            var root = document.RootElement;
            Assert.Equal(1, root.GetProperty("version").GetInt32());
            return new ReplayVectors(
                root.GetProperty("version").GetInt32(),
                root.GetProperty("clock").GetString()!,
                root.GetProperty("sessionId").GetString()!,
                root.GetProperty("turnId").GetString()!,
                root.GetProperty("scenarios").EnumerateArray().Select(ReplayScenario.Load).ToList());
        }
    }

    private sealed record ReplayScenario(
        string Name,
        Dictionary<string, object>? Inputs,
        int? MaxIterations,
        string[] Expected)
    {
        public static ReplayScenario Load(JsonElement element)
        {
            return new ReplayScenario(
                element.GetProperty("name").GetString()!,
                element.TryGetProperty("inputs", out var inputs) ? ToDictionary(inputs) : null,
                element.TryGetProperty("maxIterations", out var maxIterations) ? maxIterations.GetInt32() : null,
                element.GetProperty("expected").EnumerateArray().Select(item => item.GetString()!).ToArray());
        }
    }

    private static Dictionary<string, object> ToDictionary(JsonElement element)
    {
        return element.EnumerateObject().ToDictionary(property => property.Name, property => ToObject(property.Value)!);
    }

    private static object? ToObject(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number => element.TryGetInt32(out var intValue) ? intValue : element.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Object => ToDictionary(element),
            JsonValueKind.Array => element.EnumerateArray().Select(ToObject).ToList(),
            _ => null
        };
    }
}

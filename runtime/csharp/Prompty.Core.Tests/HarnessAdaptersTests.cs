// Copyright (c) Microsoft. All rights reserved.

using System.Text.Json;
using Prompty.Core;

namespace Prompty.Core.Tests;

public class HarnessAdaptersTests
{
    [Fact]
    public void CollectingEventSink_CapturesEvents()
    {
        var sink = new CollectingEventSink();

        Assert.True(sink.EmitTurn(TurnEvent()));
        Assert.True(sink.EmitSession(SessionEvent()));

        Assert.Equal("turn-event", sink.TurnEvents.Single().Id);
        Assert.Equal("session-event", sink.SessionEvents.Single().Id);
    }

    [Fact]
    public void JsonlEventJournalWriter_WritesRecords()
    {
        var directory = Directory.CreateTempSubdirectory("prompty-trace-");
        try
        {
            var path = Path.Combine(directory.FullName, "trace.jsonl");
            var writer = new JsonlEventJournalWriter(path);

            writer.AppendTurn(TurnEvent());
            writer.AppendSession(SessionEvent());
            writer.Close(new SessionSummary { SessionId = "session-1", Turns = 1 });

            var lines = File.ReadAllLines(path)
                .Select(line => JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(line)!)
                .ToList();

            Assert.Equal(new[] { "turn", "session", "summary" }, lines.Select(line => line["kind"].GetString()).ToArray());
            Assert.Equal("turn-event", lines[0]["event"].GetProperty("id").GetString());
            Assert.Equal("session-event", lines[1]["event"].GetProperty("id").GetString());
            Assert.Equal("session-1", lines[2]["summary"].GetProperty("sessionId").GetString());
            Assert.DoesNotContain("\r\n", File.ReadAllText(path));
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }

    [Fact]
    public void JsonlEventJournalWriter_ReturnsFalseAfterClose()
    {
        var directory = Directory.CreateTempSubdirectory("prompty-trace-");
        try
        {
            var writer = new JsonlEventJournalWriter(Path.Combine(directory.FullName, "trace.jsonl"));

            Assert.True(writer.Close(null));
            Assert.False(writer.AppendTurn(TurnEvent()));
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }

    [Fact]
    public async Task InMemoryCheckpointStore_StoresCheckpoints()
    {
        var store = new InMemoryCheckpointStore();
        var checkpoint = new Checkpoint { Id = "checkpoint-1", SessionId = "session-1", Title = "First" };

        Assert.Same(checkpoint, await store.SaveAsync(checkpoint));
        Assert.Same(checkpoint, await store.LoadAsync("session-1", "checkpoint-1"));
        Assert.Null(await store.LoadAsync("session-1", "missing"));
        Assert.Equal([checkpoint], await store.ListCheckpointsAsync("session-1"));
    }

    [Fact]
    public async Task InMemoryCheckpointStore_RequiresKeys()
    {
        var store = new InMemoryCheckpointStore();

        await Assert.ThrowsAsync<ArgumentException>(() =>
            store.SaveAsync(new Checkpoint { Id = "checkpoint-1", Title = "Missing session" }));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            store.SaveAsync(new Checkpoint { SessionId = "session-1", Title = "Missing id" }));
    }

    [Fact]
    public async Task PermissionResolvers_ReturnDecisions()
    {
        var request = new PermissionRequest
        {
            RequestId = "permission-1",
            ToolCallId = "tool-call-1",
            Permission = "tool.execute"
        };

        var allow = await new AllowAllPermissionResolver().RequestAsync(request);
        var deny = await new DenyAllPermissionResolver().RequestAsync(request);

        Assert.True(allow.Approved);
        Assert.Equal("allow_all", allow.Reason);
        Assert.Equal("permission-1", allow.RequestId);
        Assert.Equal("tool-call-1", allow.ToolCallId);
        Assert.False(deny.Approved);
        Assert.Equal("deny_all", deny.Reason);
    }

    [Fact]
    public async Task FunctionHostToolExecutor_ExecutesRegisteredHandlers()
    {
        var executor = new FunctionHostToolExecutor(new Dictionary<string, HostToolHandler>
        {
            ["add"] = (args, _) => Task.FromResult<object?>(Convert.ToInt32(args!["a"]) + Convert.ToInt32(args["b"]))
        });

        var result = await executor.ExecuteAsync(new HostToolRequest
        {
            RequestId = "exec-1",
            ToolName = "add",
            Arguments = new Dictionary<string, object> { ["a"] = 2, ["b"] = 3 }
        });

        Assert.True(result.Success);
        Assert.Equal("exec-1", result.RequestId);
        Assert.Equal("add", result.ToolName);
        Assert.Equal(5, result.Result);
    }

    [Fact]
    public async Task FunctionHostToolExecutor_PassesEmptyArguments()
    {
        var executor = new FunctionHostToolExecutor(new Dictionary<string, HostToolHandler>
        {
            ["count"] = (args, _) => Task.FromResult<object?>(args.Count)
        });

        var result = await executor.ExecuteAsync(new HostToolRequest { ToolName = "count" });

        Assert.True(result.Success);
        Assert.Equal(0, result.Result);
    }

    [Fact]
    public async Task FunctionHostToolExecutor_ReturnsFailureResults()
    {
        var executor = new FunctionHostToolExecutor(new Dictionary<string, HostToolHandler>
        {
            ["fail"] = (_, _) => throw new InvalidOperationException("boom")
        });

        var missing = await executor.ExecuteAsync(new HostToolRequest { ToolName = "missing" });
        var thrown = await executor.ExecuteAsync(new HostToolRequest { ToolName = "fail" });

        Assert.False(missing.Success);
        Assert.Equal("not_found", missing.ErrorKind);
        Assert.False(thrown.Success);
        Assert.Equal("exception", thrown.ErrorKind);
        var result = Assert.IsType<Dictionary<string, object?>>(thrown.Result);
        Assert.Equal("boom", result["message"]);
    }

    private static TurnEvent TurnEvent() => new()
    {
        Id = "turn-event",
        Type = TurnEventType.TurnStart,
        Timestamp = "2026-06-10T00:00:00Z",
        Payload = new Dictionary<string, object> { ["phase"] = "start" }
    };

    private static SessionEvent SessionEvent() => new()
    {
        Id = "session-event",
        Type = SessionEventType.SessionStart,
        Timestamp = "2026-06-10T00:00:00Z",
        SessionId = "session-1",
        Payload = new Dictionary<string, object> { ["phase"] = "start" }
    };
}

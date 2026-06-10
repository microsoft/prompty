// Copyright (c) Microsoft. All rights reserved.

using System.Diagnostics;
using System.Text.Json;

namespace Prompty.Core;

/// <summary>
/// Captures emitted turn and session events in memory.
/// </summary>
public sealed class CollectingEventSink : IEventSink
{
    private readonly object _lock = new();
    private readonly List<TurnEvent> _turnEvents = [];
    private readonly List<SessionEvent> _sessionEvents = [];

    public List<TurnEvent> TurnEvents
    {
        get
        {
            lock (_lock)
            {
                return [.. _turnEvents];
            }
        }
    }

    public List<SessionEvent> SessionEvents
    {
        get
        {
            lock (_lock)
            {
                return [.. _sessionEvents];
            }
        }
    }

    public bool EmitTurn(TurnEvent turnEvent)
    {
        lock (_lock)
        {
            _turnEvents.Add(turnEvent);
        }
        return true;
    }

    public bool EmitSession(SessionEvent sessionEvent)
    {
        lock (_lock)
        {
            _sessionEvents.Add(sessionEvent);
        }
        return true;
    }
}

/// <summary>
/// Appends replayable trace records as newline-delimited JSON.
/// </summary>
public sealed class JsonlTraceWriter : ITraceWriter
{
    private readonly object _lock = new();
    private readonly string _path;
    private bool _closed;

    public JsonlTraceWriter(string path)
    {
        _path = path;
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }
    }

    public bool AppendTurn(TurnEvent turnEvent)
    {
        return Write(new Dictionary<string, object?>
        {
            ["kind"] = "turn",
            ["event"] = turnEvent.Save()
        });
    }

    public bool AppendSession(SessionEvent sessionEvent)
    {
        return Write(new Dictionary<string, object?>
        {
            ["kind"] = "session",
            ["event"] = sessionEvent.Save()
        });
    }

    public bool Close(SessionSummary? summary)
    {
        if (summary is not null)
        {
            if (!Write(new Dictionary<string, object?>
            {
                ["kind"] = "summary",
                ["summary"] = summary.Save()
            }))
            {
                return false;
            }
        }
        _closed = true;
        return true;
    }

    private bool Write(Dictionary<string, object?> record)
    {
        lock (_lock)
        {
            if (_closed)
            {
                return false;
            }
            File.AppendAllText(_path, JsonSerializer.Serialize(record) + "\n");
            return true;
        }
    }
}

/// <summary>
/// Stores checkpoints in memory by session and checkpoint identifier.
/// </summary>
public sealed class InMemoryCheckpointStore : ICheckpointStore
{
    private readonly object _lock = new();
    private readonly Dictionary<(string SessionId, string CheckpointId), Checkpoint> _checkpoints = [];

    public Task<Checkpoint> SaveAsync(Checkpoint checkpoint)
    {
        var key = RequireCheckpointKey(checkpoint);
        lock (_lock)
        {
            _checkpoints[key] = checkpoint;
        }
        return Task.FromResult(checkpoint);
    }

    public Task<Checkpoint?> LoadAsync(string sessionId, string checkpointId)
    {
        Checkpoint? checkpoint;
        lock (_lock)
        {
            _checkpoints.TryGetValue((sessionId, checkpointId), out checkpoint);
        }
        return Task.FromResult(checkpoint);
    }

    public Task<List<Checkpoint>> ListCheckpointsAsync(string sessionId)
    {
        List<Checkpoint> checkpoints;
        lock (_lock)
        {
            checkpoints = _checkpoints.Values.Where(checkpoint => checkpoint.SessionId == sessionId).ToList();
        }
        return Task.FromResult(checkpoints);
    }

    private static (string SessionId, string CheckpointId) RequireCheckpointKey(Checkpoint checkpoint)
    {
        if (string.IsNullOrEmpty(checkpoint.SessionId))
        {
            throw new ArgumentException("Checkpoint SessionId is required", nameof(checkpoint));
        }
        if (string.IsNullOrEmpty(checkpoint.Id))
        {
            throw new ArgumentException("Checkpoint Id is required", nameof(checkpoint));
        }
        return (checkpoint.SessionId, checkpoint.Id);
    }
}

/// <summary>
/// Resolves every permission request as approved.
/// </summary>
public sealed class AllowAllPermissionResolver : IPermissionResolver
{
    public Task<PermissionDecision> RequestAsync(PermissionRequest request)
    {
        return Task.FromResult(new PermissionDecision
        {
            RequestId = request.RequestId,
            ToolCallId = request.ToolCallId,
            Permission = request.Permission,
            Approved = true,
            Reason = "allow_all"
        });
    }
}

/// <summary>
/// Resolves every permission request as denied.
/// </summary>
public sealed class DenyAllPermissionResolver : IPermissionResolver
{
    public Task<PermissionDecision> RequestAsync(PermissionRequest request)
    {
        return Task.FromResult(new PermissionDecision
        {
            RequestId = request.RequestId,
            ToolCallId = request.ToolCallId,
            Permission = request.Permission,
            Approved = false,
            Reason = "deny_all"
        });
    }
}

public delegate Task<object?> HostToolHandler(IDictionary<string, object> arguments, HostToolRequest request);

/// <summary>
/// Dispatches host tool requests to registered local functions.
/// </summary>
public sealed class FunctionHostToolExecutor : IHostToolExecutor
{
    private readonly IReadOnlyDictionary<string, HostToolHandler> _handlers;

    public FunctionHostToolExecutor(IReadOnlyDictionary<string, HostToolHandler> handlers)
    {
        _handlers = handlers;
    }

    public async Task<HostToolResult> ExecuteAsync(HostToolRequest request)
    {
        var stopwatch = Stopwatch.StartNew();
        if (!_handlers.TryGetValue(request.ToolName, out var handler))
        {
            return new HostToolResult
            {
                RequestId = request.RequestId,
                ToolCallId = request.ToolCallId,
                ToolName = request.ToolName,
                Success = false,
                ErrorKind = "not_found",
                Result = new Dictionary<string, object?> { ["message"] = $"No host tool registered for '{request.ToolName}'" },
                DurationMs = stopwatch.Elapsed.TotalMilliseconds
            };
        }

        try
        {
            var result = await handler(request.Arguments ?? new Dictionary<string, object>(), request);
            return new HostToolResult
            {
                RequestId = request.RequestId,
                ToolCallId = request.ToolCallId,
                ToolName = request.ToolName,
                Success = true,
                Result = result,
                DurationMs = stopwatch.Elapsed.TotalMilliseconds
            };
        }
        catch (Exception exception)
        {
            return new HostToolResult
            {
                RequestId = request.RequestId,
                ToolCallId = request.ToolCallId,
                ToolName = request.ToolName,
                Success = false,
                ErrorKind = "exception",
                Result = new Dictionary<string, object?> { ["message"] = exception.Message },
                DurationMs = stopwatch.Elapsed.TotalMilliseconds
            };
        }
    }
}

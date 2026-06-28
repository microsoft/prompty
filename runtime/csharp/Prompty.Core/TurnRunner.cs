// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

public sealed class TurnModelRequest
{
    public string SessionId { get; init; } = string.Empty;
    public string TurnId { get; init; } = string.Empty;
    public int Iteration { get; init; }
    public IDictionary<string, object> Inputs { get; init; } = new Dictionary<string, object>();
    public TurnOptions Options { get; init; } = new();
    public IReadOnlyList<HostToolResult> ToolResults { get; init; } = [];
}

public sealed class TurnModelResponse
{
    public object? Output { get; init; }
    public IReadOnlyList<HostToolRequest> ToolRequests { get; init; } = [];
    public IDictionary<string, object> CheckpointState { get; init; } = new Dictionary<string, object>();
}

public sealed class RunTurnRequest
{
    public string SessionId { get; init; } = string.Empty;
    public string TurnId { get; init; } = string.Empty;
    public IDictionary<string, object> Inputs { get; init; } = new Dictionary<string, object>();
    public TurnOptions Options { get; init; } = new();
}

public sealed class RunTurnResult
{
    public string SessionId { get; init; } = string.Empty;
    public string TurnId { get; init; } = string.Empty;
    public string Status { get; init; } = "success";
    public object? Output { get; init; }
    public int Iterations { get; init; }
    public IReadOnlyList<HostToolResult> ToolResults { get; init; } = [];
    public IReadOnlyList<Checkpoint> Checkpoints { get; init; } = [];
}

public sealed class ReferenceTurnRunner
{
    private readonly IEventSink _eventSink;
    private readonly IEventJournalWriter _journal;
    private readonly ICheckpointStore _checkpointStore;
    private readonly IPermissionResolver _permissionResolver;
    private readonly IHostToolExecutor _hostToolExecutor;
    private readonly Func<TurnModelRequest, Task<TurnModelResponse>> _invokeModel;
    private readonly Func<string> _now;
    private readonly Func<string, string> _nextId;

    public ReferenceTurnRunner(
        IEventSink eventSink,
        IEventJournalWriter journal,
        ICheckpointStore checkpointStore,
        IPermissionResolver permissionResolver,
        IHostToolExecutor hostToolExecutor,
        Func<TurnModelRequest, Task<TurnModelResponse>> invokeModel,
        Func<string>? now = null,
        Func<string, string>? nextId = null)
    {
        _eventSink = eventSink;
        _journal = journal;
        _checkpointStore = checkpointStore;
        _permissionResolver = permissionResolver;
        _hostToolExecutor = hostToolExecutor;
        _invokeModel = invokeModel;
        _now = now ?? (() => DateTimeOffset.UtcNow.ToString("O"));
        var sequence = 0;
        _nextId = nextId ?? (prefix => $"{prefix}-{++sequence}");
    }

    public async Task<RunTurnResult> RunAsync(RunTurnRequest request)
    {
        var maxIterations = request.Options.MaxIterations ?? 10;
        var checkpoints = new List<Checkpoint>();
        var allToolResults = new List<HostToolResult>();
        var pendingToolResults = new List<HostToolResult>();
        object? output = null;
        var hasFinalOutput = false;
        var status = "success";
        var iterations = 0;

        RecordSession(SessionEventType.SessionStart, request.SessionId, request.TurnId, new Dictionary<string, object>
        {
            ["sessionId"] = request.SessionId,
            ["schemaVersion"] = "1"
        });
        RecordTurn(TurnEventType.TurnStart, request.TurnId, 0, new Dictionary<string, object>
        {
            ["inputs"] = request.Inputs,
            ["maxIterations"] = maxIterations
        });

        for (var iteration = 0; iteration < maxIterations; iteration++)
        {
            iterations = iteration + 1;
            RecordTurn(TurnEventType.LlmStart, request.TurnId, iteration, new Dictionary<string, object> { ["attempt"] = 0 });
            var modelResponse = await _invokeModel(new TurnModelRequest
            {
                SessionId = request.SessionId,
                TurnId = request.TurnId,
                Iteration = iteration,
                Inputs = request.Inputs,
                Options = request.Options,
                ToolResults = pendingToolResults
            });
            RecordTurn(TurnEventType.LlmComplete, request.TurnId, iteration, new Dictionary<string, object>());

            var checkpoint = await SaveCheckpointAsync(request.SessionId, request.TurnId, iteration, modelResponse);
            checkpoints.Add(checkpoint);

            if (modelResponse.ToolRequests.Count == 0)
            {
                output = modelResponse.Output;
                hasFinalOutput = true;
                break;
            }

            pendingToolResults = [];
            foreach (var toolRequest in modelResponse.ToolRequests)
            {
                var toolResult = await ResolveAndExecuteToolAsync(request.TurnId, iteration, toolRequest);
                pendingToolResults.Add(toolResult);
                allToolResults.Add(toolResult);
            }

            RecordTurn(TurnEventType.MessagesUpdated, request.TurnId, iteration, new Dictionary<string, object>
            {
                ["toolResults"] = pendingToolResults.Select(result => result.Save()).ToList()
            });
        }

        if (!hasFinalOutput && pendingToolResults.Count > 0)
        {
            status = "error";
            output = new Dictionary<string, object> { ["message"] = "Maximum turn iterations reached" };
            RecordTurn(TurnEventType.Error, request.TurnId, iterations, new Dictionary<string, object>
            {
                ["errorKind"] = "max_iterations",
                ["message"] = "Maximum turn iterations reached"
            });
        }

        RecordTurn(TurnEventType.TurnEnd, request.TurnId, iterations, new Dictionary<string, object?>
        {
            ["iterations"] = iterations,
            ["status"] = status,
            ["response"] = output
        }!);
        RecordSession(SessionEventType.SessionEnd, request.SessionId, request.TurnId, new Dictionary<string, object>
        {
            ["sessionId"] = request.SessionId,
            ["status"] = status,
            ["reason"] = "turn_complete"
        });
        _journal.Close(new SessionSummary
        {
            SessionId = request.SessionId,
            Status = status == "success" ? SessionSummaryStatus.Success : SessionSummaryStatus.Error,
            Turns = 1,
            Checkpoints = checkpoints.Count
        });

        return new RunTurnResult
        {
            SessionId = request.SessionId,
            TurnId = request.TurnId,
            Status = status,
            Output = output,
            Iterations = iterations,
            ToolResults = allToolResults,
            Checkpoints = checkpoints
        };
    }

    private async Task<Checkpoint> SaveCheckpointAsync(string sessionId, string turnId, int iteration, TurnModelResponse response)
    {
        var state = new Dictionary<string, object?>
        {
            ["iteration"] = iteration,
            ["output"] = response.Output,
            ["toolRequests"] = response.ToolRequests.Select(request => request.Save()).ToList()
        };
        foreach (var (key, value) in response.CheckpointState)
        {
            state[key] = value;
        }

        var checkpoint = new Checkpoint
        {
            Id = $"{turnId}-checkpoint-{iteration}",
            SessionId = sessionId,
            TurnId = turnId,
            CheckpointNumber = iteration + 1,
            Title = $"Turn {turnId} iteration {iteration}",
            State = state!,
            CreatedAt = _now()
        };
        var saved = await _checkpointStore.SaveAsync(checkpoint);
        RecordSession(SessionEventType.CheckpointCreated, sessionId, turnId, new Dictionary<string, object?>
        {
            ["checkpointId"] = saved.Id,
            ["checkpointNumber"] = saved.CheckpointNumber
        }!);
        return saved;
    }

    private async Task<HostToolResult> ResolveAndExecuteToolAsync(string turnId, int iteration, HostToolRequest toolRequest)
    {
        var permission = new PermissionRequest
        {
            RequestId = toolRequest.RequestId is null ? _nextId("permission") : $"{toolRequest.RequestId}-permission",
            ToolCallId = toolRequest.ToolCallId,
            Permission = "tool.execute",
            Target = toolRequest.ToolName,
            Details = toolRequest.Save()
        };
        RecordTurn(TurnEventType.PermissionRequested, turnId, iteration, permission.Save());
        var decision = await _permissionResolver.RequestAsync(permission);
        RecordTurn(TurnEventType.PermissionCompleted, turnId, iteration, decision.Save());

        if (!decision.Approved)
        {
            return new HostToolResult
            {
                RequestId = toolRequest.RequestId,
                ToolCallId = toolRequest.ToolCallId,
                ToolName = toolRequest.ToolName,
                Success = false,
                ErrorKind = "permission_denied",
                Result = new Dictionary<string, object?> { ["message"] = decision.Reason ?? "Permission denied" }
            };
        }

        RecordTurn(TurnEventType.ToolExecutionStart, turnId, iteration, toolRequest.Save());
        var result = await _hostToolExecutor.ExecuteAsync(toolRequest);
        RecordTurn(TurnEventType.ToolExecutionComplete, turnId, iteration, result.Save());
        RecordTurn(TurnEventType.ToolResult, turnId, iteration, result.Save());
        return result;
    }

    private void RecordTurn(TurnEventType type, string turnId, int iteration, IDictionary<string, object> payload)
    {
        var turnEvent = new TurnEvent
        {
            Id = _nextId("turn-event"),
            Type = type,
            Timestamp = _now(),
            TurnId = turnId,
            Iteration = iteration,
            Payload = payload
        };
        _eventSink.EmitTurn(turnEvent);
        _journal.AppendTurn(turnEvent);
    }

    private void RecordSession(SessionEventType type, string sessionId, string turnId, IDictionary<string, object> payload)
    {
        var sessionEvent = new SessionEvent
        {
            Id = _nextId("session-event"),
            Type = type,
            Timestamp = _now(),
            SessionId = sessionId,
            TurnId = turnId,
            Payload = payload
        };
        _eventSink.EmitSession(sessionEvent);
        _journal.AppendSession(sessionEvent);
    }
}

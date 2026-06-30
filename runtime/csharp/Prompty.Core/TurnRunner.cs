// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

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
        var options = request.Options ?? new TurnOptions();
        var inputs = request.Inputs ?? new Dictionary<string, object>();
        var maxIterations = options.MaxIterations ?? 10;
        var checkpoints = new List<Checkpoint>();
        var allToolResults = new List<HostToolResult>();
        var pendingToolResults = new List<HostToolResult>();
        object? output = null;
        var hasFinalOutput = false;
        var status = RunTurnStatus.Success;
        var iterations = 0;

        RecordSession(SessionEventType.SessionStart, request.SessionId, request.TurnId, new Dictionary<string, object>
        {
            ["sessionId"] = request.SessionId,
            ["schemaVersion"] = "1"
        });
        RecordTurn(TurnEventType.TurnStart, request.TurnId, 0, new Dictionary<string, object>
        {
            ["inputs"] = inputs,
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
                Inputs = inputs,
                Options = options,
                ToolResults = pendingToolResults
            });
            RecordTurn(TurnEventType.LlmComplete, request.TurnId, iteration, new Dictionary<string, object>());

            var checkpoint = await SaveCheckpointAsync(request.SessionId, request.TurnId, iteration, modelResponse);
            checkpoints.Add(checkpoint);

            var toolRequests = modelResponse.ToolRequests ?? [];
            if (toolRequests.Count == 0)
            {
                output = modelResponse.Output;
                hasFinalOutput = true;
                break;
            }

            pendingToolResults = [];
            foreach (var toolRequest in toolRequests)
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
            status = RunTurnStatus.Error;
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
            ["status"] = status == RunTurnStatus.Success ? "success" : "error",
            ["response"] = output
        }!);
        RecordSession(SessionEventType.SessionEnd, request.SessionId, request.TurnId, new Dictionary<string, object>
        {
            ["sessionId"] = request.SessionId,
            ["status"] = status == RunTurnStatus.Success ? "success" : "error",
            ["reason"] = "turn_complete"
        });
        _journal.Close(new SessionSummary
        {
            SessionId = request.SessionId,
            Status = status == RunTurnStatus.Success ? SessionSummaryStatus.Success : SessionSummaryStatus.Error,
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
            ["toolRequests"] = (response.ToolRequests ?? []).Select(request => request.Save()).ToList()
        };
        foreach (var (key, value) in response.CheckpointState ?? new Dictionary<string, object>())
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

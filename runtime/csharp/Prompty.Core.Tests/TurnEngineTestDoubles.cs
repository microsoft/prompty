// Copyright (c) Microsoft. All rights reserved.

using Prompty.Core;

namespace Prompty.Core.Tests;

// -----------------------------------------------------------------------
// Deterministic test doubles shared by the canonical TurnEngine test suite
// (TurnEngineVectorTests, TurnEngineResumeTests, TurnEngineReconciliationTests).
// -----------------------------------------------------------------------

/// <summary>Deterministic, monotonically increasing clock for engine tests.</summary>
internal sealed class FakeEngineClock : IEngineClock
{
    private long _tick;

    public string Now() => $"2024-01-01T00:00:{_tick++:D2}Z";
}

/// <summary>Deterministic per-kind sequential id generator for engine tests.</summary>
internal sealed class FakeEngineIdGenerator : IEngineIdGenerator
{
    private readonly Dictionary<string, int> _counters = [];

    public string NextId(string kind)
    {
        var next = _counters.TryGetValue(kind, out var current) ? current + 1 : 1;
        _counters[kind] = next;
        return $"{kind}-{next}";
    }
}

/// <summary>One scripted model turn step: either a final output, or an assistant message plus tool requests.</summary>
internal sealed class ScriptedModelStep
{
    public string? Assistant { get; init; }

    public object? Output { get; init; }

    public IList<ModelToolRequest> Tools { get; init; } = [];

    public InvocationContextPortability? NextPortability { get; init; }

    public IList<DelegatedStateReference>? DelegatedState { get; init; }
}

/// <summary>Model port that replays a fixed script of responses, one per invocation, strictly in order.</summary>
internal sealed class ScriptedModelPort : IEngineModelPort
{
    private readonly Queue<ScriptedModelStep> _steps;

    public ScriptedModelPort(IEnumerable<ScriptedModelStep> steps) => _steps = new Queue<ScriptedModelStep>(steps);

    public int InvocationCount { get; private set; }

    public Task<ModelInvocationResponse> InvokeAsync(
        ModelInvocationRequest request,
        CancellationToken cancellationToken,
        IEngineModelStreamPort stream)
    {
        InvocationCount++;
        if (_steps.Count == 0)
        {
            throw PortError.Configuration("scripted model script exhausted");
        }

        var step = _steps.Dequeue();
        var response = new ModelInvocationResponse
        {
            Output = step.Output,
            AssistantMessages = step.Assistant is null ? [] : [Message.Assistant(step.Assistant)],
            ToolRequests = [.. step.Tools],
        };

        if (step.NextPortability is not null)
        {
            response.NextContextState = new InvocationContextState
            {
                Portability = step.NextPortability.Value,
                DelegatedState = step.DelegatedState ?? [],
            };
        }

        return Task.FromResult(response);
    }
}

/// <summary>Model port that always throws — proves the model is never re-invoked after resume/reconciliation.</summary>
internal sealed class ThrowingModelPort : IEngineModelPort
{
    public Task<ModelInvocationResponse> InvokeAsync(
        ModelInvocationRequest request,
        CancellationToken cancellationToken,
        IEngineModelStreamPort stream) =>
        throw new InvalidOperationException("model must not be invoked again");
}

/// <summary>Model port whose single scripted attempt always fails with an indeterminate (outcome-unknown) error.</summary>
internal sealed class IndeterminateModelPort : IEngineModelPort
{
    public int InvocationCount { get; private set; }

    public Task<ModelInvocationResponse> InvokeAsync(
        ModelInvocationRequest request,
        CancellationToken cancellationToken,
        IEngineModelStreamPort stream)
    {
        InvocationCount++;
        throw PortError.Indeterminate("model invocation outcome is unknown");
    }
}

/// <summary>
/// Tool port that resolves each request's output from a lookup table and records execution
/// order/concurrency, so tests can prove tools run sequentially and in model-provided order.
/// </summary>
internal sealed class EchoToolPort : IEngineToolPort
{
    private readonly IReadOnlyDictionary<string, string> _outputs;
    private readonly HashSet<string> _forbiddenRequestIds;
    private int _inFlight;

    public EchoToolPort(IReadOnlyDictionary<string, string>? outputs = null, IEnumerable<string>? forbiddenRequestIds = null)
    {
        _outputs = outputs ?? new Dictionary<string, string>();
        _forbiddenRequestIds = forbiddenRequestIds is null ? [] : [.. forbiddenRequestIds];
    }

    /// <summary>Request ids executed so far, in the order they were executed.</summary>
    public List<string> ExecutedRequestIds { get; } = [];

    /// <summary>The largest number of concurrently in-flight tool executions observed.</summary>
    public int MaxObservedConcurrency { get; private set; }

    public async Task<ModelToolResult> ExecuteAsync(ModelToolRequest request, CancellationToken cancellationToken)
    {
        if (_forbiddenRequestIds.Contains(request.Id))
        {
            throw new InvalidOperationException($"tool request '{request.Id}' must not execute again");
        }

        var concurrent = Interlocked.Increment(ref _inFlight);
        MaxObservedConcurrency = Math.Max(MaxObservedConcurrency, concurrent);
        try
        {
            // Yield to make any accidental parallel invocation observable.
            await Task.Yield();
            ExecutedRequestIds.Add(request.Id);
            var output = _outputs.TryGetValue(request.Id, out var value) ? value : request.Name;
            return new ModelToolResult
            {
                RequestId = request.Id,
                Name = request.Name,
                Outcome = ModelToolOutcome.Success,
                Output = output,
            };
        }
        finally
        {
            Interlocked.Decrement(ref _inFlight);
        }
    }
}

/// <summary>Tool port whose single configured request id fails with an indeterminate (outcome-unknown) error.</summary>
internal sealed class IndeterminateToolPort : IEngineToolPort
{
    private readonly string _requestId;
    private readonly IEngineToolPort _inner;

    public IndeterminateToolPort(string requestId, IEngineToolPort inner)
    {
        _requestId = requestId;
        _inner = inner;
    }

    public Task<ModelToolResult> ExecuteAsync(ModelToolRequest request, CancellationToken cancellationToken) =>
        request.Id == _requestId
            ? throw PortError.Indeterminate($"tool '{request.Id}' outcome is unknown")
            : _inner.ExecuteAsync(request, cancellationToken);
}

/// <summary>Permission port that denies tool requests whose name is in the deny list.</summary>
internal sealed class DenyByNamePermissionPort : IEnginePermissionPort
{
    private readonly HashSet<string> _denied;

    public DenyByNamePermissionPort(IEnumerable<string> deniedNames) => _denied = [.. deniedNames];

    public Task<EnginePermissionDecision> AuthorizeAsync(ModelToolRequest request, CancellationToken cancellationToken) =>
        Task.FromResult(_denied.Contains(request.Name)
            ? new EnginePermissionDecision { Approved = false, Reason = "Permission was denied" }
            : new EnginePermissionDecision { Approved = true });
}

/// <summary>Durability port that records every appended event/checkpoint in memory for assertions.</summary>
internal sealed class RecordingDurabilityPort : IEngineDurabilityPort
{
    public List<EngineEvent> Events { get; } = [];

    public List<EngineCheckpoint> Checkpoints { get; } = [];

    public Task AppendAsync(EngineEvent @event)
    {
        Events.Add(@event);
        return Task.CompletedTask;
    }

    public Task AppendWithCheckpointAsync(IReadOnlyList<EngineEvent> events, EngineCheckpoint checkpoint)
    {
        Events.AddRange(events);
        Checkpoints.Add(checkpoint);
        return Task.CompletedTask;
    }
}

/// <summary>Post-commit port that always fails, to prove post-commit failures are reported non-fatally.</summary>
internal sealed class FailingPostCommitPort : IEnginePostCommitPort
{
    public const string FailureMessage = "post-commit sink unavailable";

    public List<string> AttemptedEffectIds { get; } = [];

    public Task AfterCommitAsync(string effectId, TurnCommit commit, CancellationToken cancellationToken)
    {
        AttemptedEffectIds.Add(effectId);
        throw PortError.Configuration(FailureMessage);
    }
}

/// <summary>Post-commit port that records every commit it was asked to run an effect for.</summary>
internal sealed class RecordingPostCommitPort : IEnginePostCommitPort
{
    public List<(string EffectId, TurnCommit Commit)> Commits { get; } = [];

    public Task AfterCommitAsync(string effectId, TurnCommit commit, CancellationToken cancellationToken)
    {
        Commits.Add((effectId, commit));
        return Task.CompletedTask;
    }
}

// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// The bundle of runtime-local ports the <see cref="TurnEngine"/> uses to invoke the model,
/// enforce host policy, resolve permissions, execute tools, persist durable state, and run
/// post-commit effects. Only <see cref="Model"/>, <see cref="Tools"/>, <see cref="Clock"/>, and
/// <see cref="Ids"/> are required; every other port has a conservative no-op default.
/// </summary>
public sealed class TurnEngineEffects
{
    /// <summary>The model invocation port. Required.</summary>
    public required IEngineModelPort Model { get; init; }

    /// <summary>The tool execution port. Required.</summary>
    public required IEngineToolPort Tools { get; init; }

    /// <summary>The deterministic clock used to timestamp every emitted event. Required.</summary>
    public required IEngineClock Clock { get; init; }

    /// <summary>The deterministic id generator used for run/invocation/checkpoint/event ids. Required.</summary>
    public required IEngineIdGenerator Ids { get; init; }

    /// <summary>The streaming sink handed to the model port. Defaults to a no-op sink.</summary>
    public IEngineModelStreamPort Stream { get; init; } = new NoopModelStreamPort();

    /// <summary>The context assembly port. Defaults to preserving the canonical messages unchanged.</summary>
    public IEngineContextPort Context { get; init; } = new PassthroughEngineContextPort();

    /// <summary>The host policy port. Defaults to a pass-through policy.</summary>
    public IEngineHostPolicyPort Policy { get; init; } = new NoopHostPolicyPort();

    /// <summary>The retry/backoff policy port. Defaults to an immediate no-op backoff.</summary>
    public IEngineRetryPolicyPort Retry { get; init; } = new NoopRetryPolicyPort();

    /// <summary>The conversation formatting port. Defaults to a single synthetic tool-result message per result.</summary>
    public IEngineConversationPort Conversation { get; init; } = new DefaultConversationPort();

    /// <summary>The permission resolution port. Defaults to approving every tool request.</summary>
    public IEnginePermissionPort Permission { get; init; } = new AllowAllPermissionsPort();

    /// <summary>The durability port used to append events and checkpoints. Defaults to an in-memory no-op.</summary>
    public IEngineDurabilityPort Durability { get; init; } = new NoopDurabilityPort();

    /// <summary>The post-commit effect port. Defaults to a no-op that always succeeds.</summary>
    public IEnginePostCommitPort PostCommit { get; init; } = new NoopPostCommitPort();
}

/// <summary>
/// The canonical turn engine: a deterministic, resumable state machine that drives a single
/// conversational turn to completion by orchestrating host policy, context preparation, model
/// invocation, permissioned tool execution, and durable checkpointing.
/// </summary>
/// <remarks>
/// This is a line-for-line behavioral port of the Rust reference implementation at
/// <c>runtime/rust/prompty/src/engine/turn.rs</c>. Every emitted <see cref="EngineEvent"/>,
/// every <see cref="EngineCheckpoint"/> field, and every commit/cancellation/reconciliation path
/// mirrors the Rust engine so that the two runtimes agree on wire-visible behavior for the
/// shared vectors in <c>spec/vectors/engine/turn_vectors.json</c>.
/// </remarks>
public sealed class TurnEngine
{
    private readonly TurnEngineEffects _effects;

    /// <summary>Creates a new engine bound to the supplied port bundle.</summary>
    public TurnEngine(TurnEngineEffects effects)
    {
        _effects = effects ?? throw new ArgumentNullException(nameof(effects));
    }

    /// <summary>Resumes a turn from a durable <see cref="ResumeContext"/> checkpoint.</summary>
    public Task<TurnEngineResult> ResumeAsync(ResumeContext resume, CancellationToken cancellationToken) =>
        RunAsync(TurnEngineRequest.FromResume(resume), cancellationToken);

    /// <summary>Runs a turn to completion (success, cancellation, failure, or reconciliation-required).</summary>
    public async Task<TurnEngineResult> RunAsync(TurnEngineRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ValidateRequest(request);

        if (string.IsNullOrEmpty(request.RunId))
        {
            request.RunId = _effects.Ids.NextId("run");
        }

        var state = new TurnState(request);

        await EmitAsync(state, EngineEventKind.TurnStarted, invocationId: null, iteration: null, new Dictionary<string, object?>
        {
            ["maxIterations"] = state.MaxIterations,
            ["startIteration"] = state.Iteration,
            ["inputs"] = state.Inputs,
        }).ConfigureAwait(false);

        if (state.ModelReconciliationResolution is not null)
        {
            var response = state.ModelReconciliationResolution;
            state.ModelReconciliationResolution = null;
            var reconciliation = state.ModelReconciliation
                ?? throw new TurnEngineInvalidRequestException("model reconciliation response is missing durable reconciliation state");

            state.ReconciliationRequired = false;
            state.ModelReconciliation = null;

            var applyError = state.ApplyModelResponse(reconciliation.InvocationId, response);
            if (applyError is not null)
            {
                return await CommitFailedAsync(state, "provider_state_error", applyError, cancellationToken).ConfigureAwait(false);
            }

            await PersistModelReconciliationAsync(state, reconciliation.InvocationId, reconciliation, response).ConfigureAwait(false);
        }

        if (state.ReconciliationResolution is not null)
        {
            var resolution = state.ReconciliationResolution;
            state.ReconciliationResolution = null;
            await PersistReconciliationAsync(state, resolution).ConfigureAwait(false);
        }

        if (state.ReconciliationRequired)
        {
            return await CommitReconciliationAsync(
                state,
                "effect_outcome_unknown",
                "Checkpoint requires explicit effect reconciliation",
                cancellationToken).ConfigureAwait(false);
        }

        if (state.FinalOutputReady)
        {
            if (cancellationToken.IsCancellationRequested)
            {
                return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
            }

            state.Output = state.PendingOutput;
            return await ApplyFinalPolicyAsync(state, cancellationToken).ConfigureAwait(false);
        }

        while (state.Iteration < state.MaxIterations)
        {
            if (state.PendingToolRequests.Count == 0 && state.PendingModelResponse is not null)
            {
                var invocationId = state.ActiveInvocationId ?? _effects.Ids.NextId("invocation");

                List<ModelToolResult> results;
                try
                {
                    results = FinalizeToolExchange(state);
                }
                catch (PortError error)
                {
                    return await CommitFailedAsync(state, "conversation_format_error", error.Message, cancellationToken).ConfigureAwait(false);
                }

                await PersistToolExchangeAsync(state, invocationId, results).ConfigureAwait(false);
                state.ActiveInvocationId = null;
                state.Iteration += 1;
                continue;
            }

            if (cancellationToken.IsCancellationRequested)
            {
                return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
            }

            if (state.PendingToolRequests.Count > 0)
            {
                var invocationId = state.ActiveInvocationId ?? _effects.Ids.NextId("invocation");
                var toolRequest = state.PendingToolRequests[0];
                state.PendingToolRequests.RemoveAt(0);

                ModelToolResult toolResult;
                try
                {
                    toolResult = await ExecuteToolAsync(state, invocationId, toolRequest, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
                }
                catch (ToolPermissionFailure error)
                {
                    return await CommitFailedAsync(state, "permission_error", error.Error.Message, cancellationToken).ConfigureAwait(false);
                }
                catch (ToolConfigurationFailure error)
                {
                    return await CommitFailedAsync(state, "tool_configuration_error", error.Error.Message, cancellationToken).ConfigureAwait(false);
                }

                var outcomeUnknown = toolResult.Outcome == ModelToolOutcome.Indeterminate;
                state.ToolResults.Add(toolResult);
                if (state.PendingModelResponse is null)
                {
                    state.Messages.Add(Message.ToolResult(toolRequest.Id, toolResult.ModelText()));
                }

                await PersistToolResultAsync(state, invocationId, toolRequest).ConfigureAwait(false);

                if (outcomeUnknown)
                {
                    return await CommitReconciliationAsync(
                        state,
                        "effect_outcome_unknown",
                        "Tool effect outcome is unknown and requires reconciliation",
                        cancellationToken).ConfigureAwait(false);
                }

                if (state.PendingToolRequests.Count == 0 && state.PendingModelResponse is null)
                {
                    state.ActiveInvocationId = null;
                    state.Iteration += 1;
                }

                continue;
            }

            var freshInvocationId = _effects.Ids.NextId("invocation");

            if (state.PolicyAppliedForIteration)
            {
                state.PolicyAppliedForIteration = false;
            }
            else
            {
                var policyRequest = new HostPolicyRequest
                {
                    SessionId = state.SessionId,
                    TurnId = state.TurnId,
                    Iteration = state.Iteration,
                    Messages = [.. state.Messages],
                    StablePrefixMessages = state.StablePrefixMessages,
                    Inputs = state.Inputs,
                };

                HostPolicyResult policyResult;
                try
                {
                    policyResult = await _effects.Policy.BeforeModelAsync(policyRequest, cancellationToken).ConfigureAwait(false);
                }
                catch (HostPolicyException error)
                {
                    return await CommitFailedAsync(state, error.ErrorKind, error.Message, cancellationToken).ConfigureAwait(false);
                }

                if (cancellationToken.IsCancellationRequested)
                {
                    return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
                }

                if (policyResult.StablePrefixMessages < 0 || policyResult.StablePrefixMessages > policyResult.Messages.Count)
                {
                    return await CommitFailedAsync(
                        state,
                        "policy_error",
                        "host policy stable prefix exceeds rewritten message count",
                        cancellationToken).ConfigureAwait(false);
                }

                var policyChanged = !MessagesEqual(state.Messages, policyResult.Messages)
                    || state.StablePrefixMessages != policyResult.StablePrefixMessages;
                if (policyChanged)
                {
                    state.Messages = policyResult.Messages;
                    state.StablePrefixMessages = policyResult.StablePrefixMessages;
                    await PersistPolicyUpdateAsync(state, freshInvocationId, policyResult.Metadata).ConfigureAwait(false);
                    state.PolicyAppliedForIteration = false;
                }
            }

            ModelInvocationContextSnapshot snapshot;
            try
            {
                snapshot = await _effects.Context.PrepareAsync(
                    new ContextRequest
                    {
                        SessionId = state.SessionId,
                        TurnId = state.TurnId,
                        InvocationId = freshInvocationId,
                        Iteration = state.Iteration,
                        Messages = [.. state.Messages],
                        StablePrefixMessages = Math.Min(state.StablePrefixMessages, state.Messages.Count),
                        ContextState = new InvocationContextState
                        {
                            Portability = state.Portability,
                            DelegatedState = [.. state.DelegatedState],
                        },
                        Inputs = state.Inputs,
                    },
                    cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
            }
            catch (PortError error)
            {
                return await CommitFailedAsync(state, "context_error", error.Message, cancellationToken).ConfigureAwait(false);
            }

            var contextError = ValidateContextSnapshot(snapshot, state, freshInvocationId);
            if (contextError is not null)
            {
                return await CommitFailedAsync(state, "context_error", contextError, cancellationToken).ConfigureAwait(false);
            }

            await EmitAsync(state, EngineEventKind.ContextPrepared, freshInvocationId, state.Iteration, snapshot).ConfigureAwait(false);
            state.Snapshots.Add(snapshot);

            if (cancellationToken.IsCancellationRequested)
            {
                return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
            }

            var modelRequest = new ModelInvocationRequest { Context = snapshot };
            state.ActiveInvocationId = freshInvocationId;

            var attempt = 0;
            ModelInvocationResponse? modelResponse = null;
            while (modelResponse is null)
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
                }

                await EmitAsync(state, EngineEventKind.ModelInvocationStarted, freshInvocationId, state.Iteration, new Dictionary<string, object?>
                {
                    ["snapshotId"] = snapshot.Id,
                    ["attempt"] = attempt,
                    ["messageCount"] = snapshot.Messages.Count,
                }).ConfigureAwait(false);

                try
                {
                    modelResponse = await _effects.Model.InvokeAsync(
                        modelRequest,
                        cancellationToken,
                        new BestEffortModelStreamPort(_effects.Stream)).ConfigureAwait(false);
                }
                catch (PortError failure)
                {
                    if (cancellationToken.IsCancellationRequested)
                    {
                        return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
                    }

                    attempt += 1;
                    var outcomeUnknown = failure.OutcomeUnknown;
                    var exhausted = outcomeUnknown || attempt >= state.MaxModelAttempts;
                    var reason = failure.Message;

                    await EmitAsync(state, EngineEventKind.ModelInvocationFailed, freshInvocationId, state.Iteration, new Dictionary<string, object?>
                    {
                        ["attempt"] = attempt - 1,
                        ["exhausted"] = exhausted,
                        ["outcomeUnknown"] = outcomeUnknown,
                        ["message"] = reason,
                    }).ConfigureAwait(false);

                    if (outcomeUnknown)
                    {
                        state.ReconciliationRequired = true;
                        state.ModelReconciliation = new ModelReconciliationState
                        {
                            InvocationId = freshInvocationId,
                            Request = modelRequest,
                            FailedAttempt = attempt - 1,
                            Message = reason,
                            Metadata = failure.Metadata,
                        };

                        await PersistModelReconciliationRequiredAsync(state, freshInvocationId).ConfigureAwait(false);
                        return await CommitReconciliationAsync(state, "model_outcome_unknown", reason, cancellationToken).ConfigureAwait(false);
                    }

                    if (exhausted)
                    {
                        return await CommitFailedAsync(state, "model_error", reason, cancellationToken).ConfigureAwait(false);
                    }

                    try
                    {
                        await _effects.Retry.BackoffAsync(
                            new RetryPolicyRequest
                            {
                                FailedAttempts = attempt,
                                NextAttempt = attempt + 1,
                                MaxAttempts = state.MaxModelAttempts,
                                Reason = reason,
                            },
                            cancellationToken).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
                    }
                    catch (PortError source)
                    {
                        return await CommitFailedAsync(state, "retry_policy_error", source.Message, cancellationToken).ConfigureAwait(false);
                    }

                    if (cancellationToken.IsCancellationRequested)
                    {
                        return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
                    }
                }
            }

            state.ModelReconciliation = null;
            state.ReconciliationRequired = false;

            var applyModelError = state.ApplyModelResponse(freshInvocationId, modelResponse);
            if (applyModelError is not null)
            {
                return await CommitFailedAsync(state, "provider_state_error", applyModelError, cancellationToken).ConfigureAwait(false);
            }

            await PersistModelResponseAsync(state, freshInvocationId, modelResponse).ConfigureAwait(false);

            if (cancellationToken.IsCancellationRequested)
            {
                return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
            }

            if (state.FinalOutputReady)
            {
                state.Output = state.PendingOutput;
                return await ApplyFinalPolicyAsync(state, cancellationToken).ConfigureAwait(false);
            }
        }

        return await CommitFailedAsync(state, "max_iterations", "Maximum model iterations reached", cancellationToken).ConfigureAwait(false);
    }

    private static void ValidateRequest(TurnEngineRequest request)
    {
        if (string.IsNullOrEmpty(request.SessionId))
        {
            throw new TurnEngineInvalidRequestException("session_id is required");
        }

        if (string.IsNullOrEmpty(request.TurnId))
        {
            throw new TurnEngineInvalidRequestException("turn_id is required");
        }

        if (request.MaxModelAttempts <= 0)
        {
            throw new TurnEngineInvalidRequestException("max_model_attempts must be greater than zero");
        }

        if (request.StartIteration > request.MaxIterations)
        {
            throw new TurnEngineInvalidRequestException("start_iteration must not exceed max_iterations");
        }

        if (request.StablePrefixMessages > request.Messages.Count)
        {
            throw new TurnEngineInvalidRequestException("stable_prefix_messages exceeds initial message count");
        }

        if (request.Portability == InvocationContextPortability.Portable && request.DelegatedState.Count > 0)
        {
            throw new TurnEngineInvalidRequestException("portable turns cannot begin with delegated provider state");
        }
    }

    private List<ModelToolResult> FinalizeToolExchange(TurnState state)
    {
        var response = state.PendingModelResponse;
        if (response is null)
        {
            return [];
        }

        state.PendingModelResponse = null;

        if (response.ToolRequests is null || response.ToolRequests.Count == 0)
        {
            return [];
        }

        var results = new List<ModelToolResult>();
        foreach (var request in response.ToolRequests)
        {
            var match = state.ToolResults.FirstOrDefault(result => result.RequestId == request.Id);
            if (match is not null)
            {
                results.Add(match);
            }
        }

        if (results.Count != response.ToolRequests.Count)
        {
            state.PendingModelResponse = response;
            throw PortError.Configuration("tool exchange is incomplete and cannot be formatted");
        }

        IList<Message> messages;
        try
        {
            messages = _effects.Conversation.FormatToolExchange(response, results);
        }
        catch (PortError)
        {
            state.PendingModelResponse = response;
            throw;
        }

        foreach (var message in messages)
        {
            state.Messages.Add(message);
        }

        return results;
    }

    private async Task<ModelToolResult> ExecuteToolAsync(
        TurnState state,
        string invocationId,
        ModelToolRequest request,
        CancellationToken cancellationToken)
    {
        await EmitAsync(state, EngineEventKind.PermissionRequested, invocationId, state.Iteration, new Dictionary<string, object?>
        {
            ["toolRequest"] = request,
        }).ConfigureAwait(false);

        EnginePermissionDecision decision;
        try
        {
            decision = await _effects.Permission.AuthorizeAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (PortError source)
        {
            throw new ToolPermissionFailure(source);
        }

        await EmitPermissionResolvedAsync(state, invocationId, request, decision).ConfigureAwait(false);

        if (!decision.Approved)
        {
            var errorKind = decision.Metadata is not null
                && decision.Metadata.TryGetValue("errorKind", out var kindValue)
                && kindValue is string kind
                ? kind
                : "permission_denied";

            return new ModelToolResult
            {
                RequestId = request.Id,
                Name = request.Name,
                Outcome = ModelToolOutcome.Failed,
                Output = decision.Reason ?? "Permission denied",
                ErrorKind = errorKind,
                Metadata = decision.Metadata,
            };
        }

        cancellationToken.ThrowIfCancellationRequested();

        await EmitAsync(state, EngineEventKind.ToolExecutionStarted, invocationId, state.Iteration, new Dictionary<string, object?>
        {
            ["toolRequest"] = request,
        }).ConfigureAwait(false);

        cancellationToken.ThrowIfCancellationRequested();

        try
        {
            return await _effects.Tools.ExecuteAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (PortError error) when (error.ConfigurationError)
        {
            throw new ToolConfigurationFailure(error);
        }
        catch (PortError error)
        {
            return new ModelToolResult
            {
                RequestId = request.Id,
                Name = request.Name,
                Outcome = error.OutcomeUnknown ? ModelToolOutcome.Indeterminate : ModelToolOutcome.Failed,
                Output = error.OutcomeUnknown
                    ? $"Tool '{request.Name}' outcome is unknown and requires reconciliation: {error.Message}"
                    : $"Tool '{request.Name}' failed: {error.Message}",
                ErrorKind = error.OutcomeUnknown ? "effect_outcome_unknown" : "tool_error",
            };
        }
    }

    private Task EmitPermissionResolvedAsync(
        TurnState state,
        string invocationId,
        ModelToolRequest request,
        EnginePermissionDecision decision) =>
        EmitAsync(state, EngineEventKind.PermissionResolved, invocationId, state.Iteration, new Dictionary<string, object?>
        {
            ["toolRequestId"] = request.Id,
            ["decision"] = decision,
        });

    private static string? ValidateContextSnapshot(
        ModelInvocationContextSnapshot snapshot,
        TurnState state,
        string invocationId)
    {
        if (snapshot.SessionId != state.SessionId
            || snapshot.TurnId != state.TurnId
            || snapshot.InvocationId != invocationId
            || snapshot.Iteration != state.Iteration)
        {
            return $"snapshot identity ({snapshot.SessionId}/{snapshot.TurnId}/{snapshot.InvocationId}/{snapshot.Iteration}) "
                + $"does not match request ({state.SessionId}/{state.TurnId}/{invocationId}/{state.Iteration})";
        }

        if (snapshot.StablePrefixMessages < 0 || snapshot.StablePrefixMessages > snapshot.Messages.Count)
        {
            return $"stable prefix contains {snapshot.StablePrefixMessages} messages but snapshot contains {snapshot.Messages.Count}";
        }

        if (snapshot.ContextState is null)
        {
            return "snapshot context state is required";
        }

        if (snapshot.ContextState.Portability == InvocationContextPortability.Portable
            && snapshot.ContextState.DelegatedState?.Count > 0)
        {
            return "portable snapshots cannot contain delegated provider state";
        }

        if (snapshot.ContextState.Portability == InvocationContextPortability.Delegated
            && (snapshot.ContextState.DelegatedState is null || snapshot.ContextState.DelegatedState.Count == 0))
        {
            return "delegated snapshots must identify provider-held state";
        }

        return null;
    }

    private static bool MessagesEqual(IList<Message> left, IList<Message> right)
    {
        if (ReferenceEquals(left, right))
        {
            return true;
        }

        if (left.Count != right.Count)
        {
            return false;
        }

        for (var i = 0; i < left.Count; i++)
        {
            if (left[i].ToJson(indent: false) != right[i].ToJson(indent: false))
            {
                return false;
            }
        }

        return true;
    }

    private async Task PersistCheckpointAsync(
        string stage,
        string requestId,
        TurnState state,
        EngineCheckpoint checkpoint,
        IReadOnlyList<EngineEvent> events)
    {
        try
        {
            await _effects.Durability.AppendWithCheckpointAsync(events, checkpoint).ConfigureAwait(false);
        }
        catch (PortError source)
        {
            throw new TurnEngineRecoveryRequiredException(stage, requestId, checkpoint, [.. state.ToolResults], source);
        }
    }

    private async Task<EngineCheckpoint> PersistPolicyUpdateAsync(
        TurnState state,
        string invocationId,
        IDictionary<string, object?>? metadata)
    {
        var sequence = state.Sequence + 1;
        state.PolicyAppliedForIteration = true;
        var checkpoint = BuildCheckpoint(state, sequence, resumeSameIteration: true);
        var evt = BuildEvent(state, sequence, EngineEventKind.PolicyApplied, invocationId, state.Iteration, new Dictionary<string, object?>
        {
            ["messages"] = state.Messages,
            ["stablePrefixMessages"] = state.StablePrefixMessages,
            ["metadata"] = metadata,
        });
        var checkpointEvent = BuildCheckpointEvent(state, checkpoint, invocationId);

        await PersistCheckpointAsync("host policy", invocationId, state, checkpoint, [evt, checkpointEvent]).ConfigureAwait(false);
        state.Sequence = checkpoint.LastSequence + 1;
        return checkpoint;
    }

    private async Task<EngineCheckpoint> PersistToolExchangeAsync(
        TurnState state,
        string invocationId,
        IReadOnlyList<ModelToolResult> results)
    {
        var sequence = state.Sequence;
        var events = new List<EngineEvent>(results.Count + 2);
        foreach (var result in results)
        {
            sequence += 1;
            events.Add(BuildEvent(state, sequence, EngineEventKind.ToolResultCommitted, invocationId, state.Iteration, new Dictionary<string, object?>
            {
                ["toolResult"] = result,
            }));
        }

        sequence += 1;
        events.Add(BuildEvent(state, sequence, EngineEventKind.ConversationUpdated, invocationId, state.Iteration, new Dictionary<string, object?>
        {
            ["messageCount"] = state.Messages.Count,
        }));

        var checkpoint = BuildCheckpoint(state, sequence, resumeSameIteration: false);
        events.Add(BuildCheckpointEvent(state, checkpoint, invocationId));

        await PersistCheckpointAsync("tool exchange", invocationId, state, checkpoint, events).ConfigureAwait(false);
        state.Sequence = checkpoint.LastSequence + 1;
        return checkpoint;
    }

    private async Task<EngineCheckpoint> PersistModelReconciliationRequiredAsync(TurnState state, string invocationId)
    {
        var sequence = state.Sequence + 1;
        var checkpoint = BuildCheckpoint(state, sequence, resumeSameIteration: false);
        var reconciliation = state.ModelReconciliation
            ?? throw new InvalidOperationException("model reconciliation state must exist before persistence");
        var evt = BuildEvent(state, sequence, EngineEventKind.ModelReconciliationRequired, invocationId, state.Iteration, reconciliation);
        var checkpointEvent = BuildCheckpointEvent(state, checkpoint, invocationId);

        await PersistCheckpointAsync("model reconciliation", invocationId, state, checkpoint, [evt, checkpointEvent]).ConfigureAwait(false);
        state.Sequence = checkpoint.LastSequence + 1;
        return checkpoint;
    }

    private async Task<EngineCheckpoint> PersistModelReconciliationAsync(
        TurnState state,
        string invocationId,
        ModelReconciliationState reconciliation,
        ModelInvocationResponse response)
    {
        var sequence = state.Sequence + 1;
        var checkpoint = BuildCheckpoint(state, sequence, resumeSameIteration: false);
        var evt = BuildEvent(state, sequence, EngineEventKind.ModelInvocationReconciled, invocationId, state.Iteration, new Dictionary<string, object?>
        {
            ["reconciliation"] = reconciliation,
            ["hasOutput"] = response.Output is not null,
            ["toolRequests"] = response.ToolRequests?.Count ?? 0,
            ["metadata"] = response.Metadata,
        });
        var checkpointEvent = BuildCheckpointEvent(state, checkpoint, invocationId);

        await PersistCheckpointAsync("model reconciliation resolution", invocationId, state, checkpoint, [evt, checkpointEvent]).ConfigureAwait(false);
        state.Sequence = checkpoint.LastSequence + 1;
        return checkpoint;
    }

    private async Task<EngineCheckpoint> PersistModelResponseAsync(
        TurnState state,
        string invocationId,
        ModelInvocationResponse response)
    {
        var sequence = state.Sequence + 1;
        var checkpoint = BuildCheckpoint(state, sequence, resumeSameIteration: false);
        var evt = BuildEvent(state, sequence, EngineEventKind.ModelInvocationCompleted, invocationId, state.Iteration, new Dictionary<string, object?>
        {
            ["hasOutput"] = response.Output is not null,
            ["toolRequests"] = response.ToolRequests?.Count ?? 0,
            ["nextPortability"] = response.NextContextState?.Portability,
            ["delegatedState"] = response.NextContextState?.DelegatedState,
            ["metadata"] = response.Metadata,
        });
        var checkpointEvent = BuildCheckpointEvent(state, checkpoint, invocationId);

        await PersistCheckpointAsync("model response", invocationId, state, checkpoint, [evt, checkpointEvent]).ConfigureAwait(false);
        state.Sequence = checkpoint.LastSequence + 1;
        return checkpoint;
    }

    private async Task<EngineCheckpoint> PersistToolResultAsync(TurnState state, string invocationId, ModelToolRequest request)
    {
        var sequence = state.Sequence + 1;
        var checkpoint = BuildCheckpoint(state, sequence, resumeSameIteration: false);
        var result = state.ToolResults.Count > 0
            ? state.ToolResults[^1]
            : throw new InvalidOperationException("tool result must be recorded before persistence");
        var evt = BuildEvent(state, sequence, EngineEventKind.ToolExecutionCompleted, invocationId, state.Iteration, new Dictionary<string, object?>
        {
            ["toolResult"] = result,
        });
        var checkpointEvent = BuildCheckpointEvent(state, checkpoint, invocationId);

        await PersistCheckpointAsync("tool result", request.Id, state, checkpoint, [evt, checkpointEvent]).ConfigureAwait(false);
        state.Sequence = checkpoint.LastSequence + 1;
        return checkpoint;
    }

    private async Task<EngineCheckpoint> PersistReconciliationAsync(TurnState state, ModelToolResult result)
    {
        var sequence = state.Sequence + 1;
        var checkpoint = BuildCheckpoint(state, sequence, resumeSameIteration: false);
        var invocationId = state.ActiveInvocationId ?? "reconciliation";
        var evt = BuildEvent(state, sequence, EngineEventKind.ToolResultReconciled, invocationId, state.Iteration, new Dictionary<string, object?>
        {
            ["toolResult"] = result,
        });
        var checkpointEvent = BuildCheckpointEvent(state, checkpoint, invocationId);

        await PersistCheckpointAsync("tool reconciliation", result.RequestId, state, checkpoint, [evt, checkpointEvent]).ConfigureAwait(false);
        state.Sequence = checkpoint.LastSequence + 1;
        return checkpoint;
    }

    private EngineEvent BuildCheckpointEvent(TurnState state, EngineCheckpoint checkpoint, string invocationId) =>
        BuildEvent(state, checkpoint.LastSequence + 1, EngineEventKind.CheckpointCreated, invocationId, checkpoint.Iteration, new Dictionary<string, object?>
        {
            ["checkpointId"] = checkpoint.Id,
            ["includedThroughSequence"] = checkpoint.LastSequence,
        });

    private EngineCheckpoint BuildCheckpoint(TurnState state, long lastSequence, bool resumeSameIteration)
    {
        var lastToolResult = state.ToolResults.Count > 0 ? state.ToolResults[^1] : null;
        return new EngineCheckpoint
        {
            Id = _effects.Ids.NextId("checkpoint"),
            SessionId = state.SessionId,
            TurnId = state.TurnId,
            RunId = state.RunId,
            ParentRunId = state.ParentRunId,
            DelegationDepth = state.DelegationDepth,
            Iteration = state.Iteration,
            LastSequence = lastSequence,
            Messages = [.. state.Messages],
            StablePrefixMessages = state.StablePrefixMessages,
            Inputs = state.Inputs,
            ActiveInvocationId = state.ActiveInvocationId,
            PendingToolRequests = [.. state.PendingToolRequests],
            CompletedToolResults = [.. state.ToolResults],
            CompletedModelIterations = state.CompletedModelIterations,
            ReconciliationRequired = state.ReconciliationRequired || lastToolResult?.Outcome == ModelToolOutcome.Indeterminate,
            ModelReconciliation = state.ModelReconciliation,
            PendingOutput = state.PendingOutput,
            FinalOutputReady = state.FinalOutputReady,
            PendingModelResponse = state.PendingModelResponse,
            ResumeSameIteration = resumeSameIteration,
            PolicyAppliedForIteration = state.PolicyAppliedForIteration,
            ContextState = new InvocationContextState
            {
                Portability = state.Portability,
                DelegatedState = state.DelegatedState,
            },
        };
    }

    private EngineEvent BuildEvent(
        TurnState state,
        long sequence,
        EngineEventKind kind,
        string? invocationId,
        int? iteration,
        object? payload) =>
        new()
        {
            Sequence = sequence,
            Id = _effects.Ids.NextId("event"),
            Timestamp = _effects.Clock.Now(),
            SessionId = state.SessionId,
            TurnId = state.TurnId,
            RunId = state.RunId,
            ParentRunId = state.ParentRunId,
            DelegationDepth = state.DelegationDepth,
            InvocationId = invocationId,
            Iteration = iteration,
            Kind = kind,
            Payload = payload,
        };

    private async Task EmitAsync(TurnState state, EngineEventKind kind, string? invocationId, int? iteration, object? payload)
    {
        var sequence = state.Sequence + 1;
        var evt = BuildEvent(state, sequence, kind, invocationId, iteration, payload);
        try
        {
            await _effects.Durability.AppendAsync(evt).ConfigureAwait(false);
        }
        catch (PortError source)
        {
            throw new TurnEnginePortException("event journal", source);
        }

        state.Sequence = sequence;
    }

    private Task<TurnEngineResult> CommitSuccessAsync(TurnState state, CancellationToken cancellationToken) =>
        CommitAsync(state, EngineTurnStatus.Success, EngineEventKind.TurnCommitted, cancellationToken);

    private async Task<TurnEngineResult> ApplyFinalPolicyAsync(TurnState state, CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested)
        {
            return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
        }

        var request = new FinalOutputPolicyRequest
        {
            SessionId = state.SessionId,
            TurnId = state.TurnId,
            Iteration = state.Iteration,
            Messages = [.. state.Messages],
            Output = state.Output,
            Inputs = state.Inputs,
        };

        FinalOutputPolicyResult result;
        try
        {
            result = await _effects.Policy.BeforeCommitAsync(request, cancellationToken).ConfigureAwait(false);
        }
        catch (HostPolicyException error)
        {
            return cancellationToken.IsCancellationRequested
                ? await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false)
                : await CommitFailedAsync(state, error.ErrorKind, error.Message, cancellationToken).ConfigureAwait(false);
        }

        if (cancellationToken.IsCancellationRequested)
        {
            return await CommitCancelledAsync(state, cancellationToken).ConfigureAwait(false);
        }

        state.Output = result.Output;
        return await CommitSuccessAsync(state, cancellationToken).ConfigureAwait(false);
    }

    private Task<TurnEngineResult> CommitCancelledAsync(TurnState state, CancellationToken cancellationToken) =>
        CommitAsync(state, EngineTurnStatus.Cancelled, EngineEventKind.TurnCancelled, cancellationToken);

    private Task<TurnEngineResult> CommitFailedAsync(TurnState state, string errorKind, string message, CancellationToken cancellationToken)
    {
        state.Output = new Dictionary<string, object?> { ["errorKind"] = errorKind, ["message"] = message };
        return CommitAsync(state, EngineTurnStatus.Failed, EngineEventKind.TurnFailed, cancellationToken);
    }

    private Task<TurnEngineResult> CommitReconciliationAsync(
        TurnState state,
        string errorKind,
        string message,
        CancellationToken cancellationToken)
    {
        state.Output = new Dictionary<string, object?> { ["errorKind"] = errorKind, ["message"] = message };
        return CommitAsync(state, EngineTurnStatus.ReconciliationRequired, EngineEventKind.TurnReconciliationRequired, cancellationToken);
    }

    private async Task<TurnEngineResult> CommitAsync(
        TurnState state,
        EngineTurnStatus status,
        EngineEventKind kind,
        CancellationToken cancellationToken)
    {
        var iteration = state.Iteration;
        var terminalPayload = new Dictionary<string, object?> { ["status"] = status, ["output"] = state.Output };
        await EmitAsync(state, kind, invocationId: null, iteration, terminalPayload).ConfigureAwait(false);

        var commit = new TurnCommit
        {
            SessionId = state.SessionId,
            TurnId = state.TurnId,
            Status = status,
            Output = state.Output,
            Messages = [.. state.Messages],
            Iterations = state.CompletedModelIterations,
            LastSequence = state.Sequence,
            ContextState = new InvocationContextState
            {
                Portability = state.Portability,
                DelegatedState = state.DelegatedState,
            },
            ModelReconciliation = state.ModelReconciliation,
        };

        string? postCommitError = null;
        if (status == EngineTurnStatus.Success)
        {
            var sessionIdLength = System.Text.Encoding.UTF8.GetByteCount(commit.SessionId);
            var turnIdLength = System.Text.Encoding.UTF8.GetByteCount(commit.TurnId);
            var effectId = $"post_commit:{sessionIdLength}:{commit.SessionId}:{turnIdLength}:{commit.TurnId}";

            TurnEnginePortException? startError = null;
            try
            {
                await EmitAsync(state, EngineEventKind.PostCommitStarted, invocationId: null, iteration, new Dictionary<string, object?>
                {
                    ["effectId"] = effectId,
                }).ConfigureAwait(false);
            }
            catch (TurnEnginePortException error)
            {
                startError = error;
            }

            if (startError is not null)
            {
                postCommitError =
                    $"post-commit effect '{effectId}' was not started because its start event could not be persisted: {startError.Message}";
            }
            else
            {
                try
                {
                    await _effects.PostCommit.AfterCommitAsync(effectId, commit, cancellationToken).ConfigureAwait(false);

                    try
                    {
                        await EmitAsync(state, EngineEventKind.PostCommitCompleted, invocationId: null, iteration, new Dictionary<string, object?>
                        {
                            ["effectId"] = effectId,
                        }).ConfigureAwait(false);
                    }
                    catch (TurnEnginePortException completionError)
                    {
                        postCommitError =
                            $"post-commit effect '{effectId}' completed, but its completion event could not be persisted: {completionError.Message}";
                    }
                }
                catch (PortError source)
                {
                    var message = source.Message;
                    string? eventError = null;
                    try
                    {
                        await EmitAsync(state, EngineEventKind.PostCommitFailed, invocationId: null, iteration, new Dictionary<string, object?>
                        {
                            ["effectId"] = effectId,
                            ["message"] = message,
                        }).ConfigureAwait(false);
                    }
                    catch (TurnEnginePortException failureEventError)
                    {
                        eventError = failureEventError.Message;
                    }

                    postCommitError = eventError is not null
                        ? $"{message}; failure event for post-commit effect '{effectId}' could not be persisted: {eventError}"
                        : message;
                }
            }
        }

        commit.LastSequence = state.Sequence;

        return new TurnEngineResult
        {
            Commit = commit,
            Snapshots = state.Snapshots,
            ToolResults = state.ToolResults,
            PostCommitError = postCommitError,
        };
    }

    /// <summary>Signals that <see cref="IEnginePermissionPort.AuthorizeAsync"/> itself failed.</summary>
    private sealed class ToolPermissionFailure(PortError error) : Exception(error.Message)
    {
        public PortError Error { get; } = error;
    }

    /// <summary>Signals that <see cref="IEngineToolPort.ExecuteAsync"/> failed with a configuration error.</summary>
    private sealed class ToolConfigurationFailure(PortError error) : Exception(error.Message)
    {
        public PortError Error { get; } = error;
    }

    /// <summary>Prevents observational stream failures from changing semantic model execution.</summary>
    private sealed class BestEffortModelStreamPort(IEngineModelStreamPort inner) : IEngineModelStreamPort
    {
        public async Task EmitAsync(ModelStreamChunk chunk)
        {
            try
            {
                await inner.EmitAsync(chunk).ConfigureAwait(false);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                // Stream sinks own delivery diagnostics; the canonical turn outcome remains semantic-only.
            }
        }
    }

    /// <summary>
    /// The mutable in-flight state of a single turn. This is a direct transliteration of the Rust
    /// engine's <c>TurnState</c> struct and is never exposed outside <see cref="TurnEngine"/>.
    /// </summary>
    private sealed class TurnState
    {
        public TurnState(TurnEngineRequest request)
        {
            SessionId = request.SessionId;
            TurnId = request.TurnId;
            RunId = request.RunId;
            ParentRunId = request.ParentRunId;
            DelegationDepth = request.DelegationDepth;
            Messages = [.. request.Messages];
            Inputs = request.Inputs;
            MaxIterations = request.MaxIterations;
            MaxModelAttempts = request.MaxModelAttempts;
            StablePrefixMessages = request.StablePrefixMessages;
            Portability = request.Portability;
            DelegatedState = [.. request.DelegatedState];
            ActiveInvocationId = request.ActiveInvocationId;
            PendingToolRequests = [.. request.PendingToolRequests];
            ReconciliationRequired = request.ReconciliationRequired;
            ModelReconciliation = request.ModelReconciliation;
            CompletedModelIterations = request.CompletedModelIterations;
            PendingOutput = request.PendingOutput;
            FinalOutputReady = request.FinalOutputReady;
            PendingModelResponse = request.PendingModelResponse;
            PolicyAppliedForIteration = request.PolicyAppliedForIteration;
            ReconciliationResolution = request.ReconciliationResolution;
            ModelReconciliationResolution = request.ModelReconciliationResolution;

            Iteration = request.StartIteration;
            Sequence = request.InitialSequence;
            Output = null;
            Snapshots = [];
            ToolResults = [.. request.CompletedToolResults];
        }

        public string SessionId { get; }

        public string TurnId { get; }

        public string RunId { get; set; }

        public string? ParentRunId { get; }

        public int DelegationDepth { get; }

        public IList<Message> Messages { get; set; }

        public object? Inputs { get; }

        public int MaxIterations { get; }

        public int MaxModelAttempts { get; }

        public int StablePrefixMessages { get; set; }

        public InvocationContextPortability Portability { get; set; }

        public IList<DelegatedStateReference> DelegatedState { get; set; }

        public string? ActiveInvocationId { get; set; }

        public IList<ModelToolRequest> PendingToolRequests { get; set; }

        public bool ReconciliationRequired { get; set; }

        public ModelReconciliationState? ModelReconciliation { get; set; }

        public int CompletedModelIterations { get; set; }

        public object? PendingOutput { get; set; }

        public bool FinalOutputReady { get; set; }

        public ModelInvocationResponse? PendingModelResponse { get; set; }

        public bool PolicyAppliedForIteration { get; set; }

        public ModelToolResult? ReconciliationResolution { get; set; }

        public ModelInvocationResponse? ModelReconciliationResolution { get; set; }

        public int Iteration { get; set; }

        public long Sequence { get; set; }

        public object? Output { get; set; }

        public IList<ModelInvocationContextSnapshot> Snapshots { get; set; }

        public IList<ModelToolResult> ToolResults { get; set; }

        /// <summary>Applies a model response to the state. Returns an error message on failure, else null.</summary>
        public string? ApplyModelResponse(string invocationId, ModelInvocationResponse response)
        {
            CompletedModelIterations += 1;

            if (response.ToolRequests is null || response.ToolRequests.Count == 0)
            {
                foreach (var message in response.AssistantMessages ?? [])
                {
                    Messages.Add(message);
                }

                PendingModelResponse = null;
            }
            else
            {
                PendingModelResponse = response;
            }

            var error = ApplyProviderState(response);
            if (error is not null)
            {
                return error;
            }

            ActiveInvocationId = invocationId;
            PendingToolRequests = response.ToolRequests is null ? [] : [.. response.ToolRequests];
            PendingOutput = response.Output;
            FinalOutputReady = PendingToolRequests.Count == 0;
            return null;
        }

        /// <summary>Adopts provider-supplied context state. Returns an error message on invariant violation.</summary>
        public string? ApplyProviderState(ModelInvocationResponse response)
        {
            if (response.NextContextState is not null)
            {
                Portability = response.NextContextState.Portability;
                DelegatedState = response.NextContextState.DelegatedState is null
                    ? []
                    : [.. response.NextContextState.DelegatedState];
            }
            else if (Portability == InvocationContextPortability.Portable)
            {
                DelegatedState = [];
            }

            if (Portability == InvocationContextPortability.Portable && DelegatedState.Count > 0)
            {
                return "portable provider state cannot retain delegated references";
            }

            if (Portability == InvocationContextPortability.Delegated && DelegatedState.Count == 0)
            {
                return "delegated provider state requires at least one reference";
            }

            return null;
        }
    }
}

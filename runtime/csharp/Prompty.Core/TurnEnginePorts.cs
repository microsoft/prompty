// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

// -----------------------------------------------------------------------
// Runtime-local effect ports used by the canonical turn engine.
//
// The generated Model/pipeline interfaces (IPermissionResolver, IHostToolExecutor,
// IEventJournalWriter, ICheckpointStore, etc.) predate the canonical EngineEvent /
// EngineCheckpoint / TurnEngineResult contract and use different request/response
// shapes with no cancellation support. Rather than repurposing or editing those
// generated interfaces, this file defines new, distinctly named runtime-local ports
// that consume the generated domain types (ModelInvocationRequest/Response,
// ModelToolRequest/Result, EnginePermissionDecision, EngineEvent, EngineCheckpoint,
// TurnCommit, ...) directly. This mirrors the Rust reference engine's runtime-local
// traits in runtime/rust/prompty/src/engine/ports.rs.
//
// Cancellation is intentionally a runtime seam, not serialized model data. The
// canonical engine checks it at semantic boundaries and passes the native token to
// these runtime-local ports. Generated protocols such as IExecutor do not yet accept
// native cancellation, so adapters over them can only observe cancellation before or
// after an in-flight call (and while draining a stream). Durability writes remain
// deliberately non-cancellable once persistence starts.
// -----------------------------------------------------------------------

/// <summary>An ephemeral, non-durable chunk streamed while a model invocation is in flight.</summary>
public abstract record ModelStreamChunk
{
    private ModelStreamChunk()
    {
    }

    /// <summary>A partial text delta.</summary>
    public sealed record Text(string Value) : ModelStreamChunk;

    /// <summary>A partial "thinking"/reasoning delta.</summary>
    public sealed record Thinking(string Value) : ModelStreamChunk;

    /// <summary>An opaque, provider-specific streaming payload.</summary>
    public sealed record Provider(object? Value) : ModelStreamChunk;
}

/// <summary>Delivers ephemeral model stream chunks. Delivery failure must not alter semantic execution.</summary>
public interface IEngineModelStreamPort
{
    Task EmitAsync(ModelStreamChunk chunk);
}

/// <summary>Builds the immutable context snapshot used for one model invocation.</summary>
public interface IEngineContextPort
{
    /// <exception cref="PortError">Context assembly or validation failed.</exception>
    Task<ModelInvocationContextSnapshot> PrepareAsync(ContextRequest request, CancellationToken cancellationToken);
}

/// <summary>Invokes the model for one turn iteration.</summary>
public interface IEngineModelPort
{
    /// <exception cref="PortError">The invocation failed. Set <see cref="PortError.OutcomeUnknown"/> when the
    /// effect may have already happened on the provider side and requires reconciliation instead of a retry.</exception>
    Task<ModelInvocationResponse> InvokeAsync(
        ModelInvocationRequest request,
        CancellationToken cancellationToken,
        IEngineModelStreamPort stream);
}

/// <summary>Host policy applied before each model call and before the final commit.</summary>
public interface IEngineHostPolicyPort
{
    /// <exception cref="HostPolicyException">The policy deterministically rejected the turn.</exception>
    Task<HostPolicyResult> BeforeModelAsync(HostPolicyRequest request, CancellationToken cancellationToken);

    /// <exception cref="HostPolicyException">The policy deterministically rejected the turn.</exception>
    Task<FinalOutputPolicyResult> BeforeCommitAsync(FinalOutputPolicyRequest request, CancellationToken cancellationToken);
}

/// <summary>Backoff policy applied between failed model invocation attempts.</summary>
public interface IEngineRetryPolicyPort
{
    /// <summary>
    /// Wait (or otherwise apply backoff) before the next model attempt.
    /// </summary>
    /// <exception cref="OperationCanceledException">Backoff was cancelled.</exception>
    /// <exception cref="PortError">The retry policy itself failed.</exception>
    Task BackoffAsync(RetryPolicyRequest request, CancellationToken cancellationToken);
}

/// <summary>Converts one completed model/tool batch into provider-valid conversation messages.</summary>
public interface IEngineConversationPort
{
    /// <exception cref="PortError">The batch could not be formatted (for example, results are incomplete).</exception>
    IList<Message> FormatToolExchange(ModelInvocationResponse response, IReadOnlyList<ModelToolResult> results);
}

/// <summary>Authorizes a single tool request before it executes.</summary>
public interface IEnginePermissionPort
{
    /// <exception cref="PortError">The permission service itself failed (not the same as a denial, which is a
    /// normal <see cref="EnginePermissionDecision"/> with <c>Approved == false</c>).</exception>
    Task<EnginePermissionDecision> AuthorizeAsync(ModelToolRequest request, CancellationToken cancellationToken);
}

/// <summary>Executes a single approved tool request.</summary>
public interface IEngineToolPort
{
    /// <exception cref="PortError">The tool failed. Set <see cref="PortError.ConfigurationError"/> for a host
    /// misconfiguration (unknown tool, invalid binding) and <see cref="PortError.OutcomeUnknown"/> when the
    /// effect may have already happened and requires reconciliation.</exception>
    Task<ModelToolResult> ExecuteAsync(ModelToolRequest request, CancellationToken cancellationToken);
}

/// <summary>
/// Durable event journal and checkpoint store. Unlike the other engine ports, durability
/// writes are not cancellable: once the engine decides to persist an effect it must either
/// succeed or fail explicitly so the in-memory state and the durable record never diverge.
/// </summary>
public interface IEngineDurabilityPort
{
    /// <exception cref="PortError">The event could not be appended.</exception>
    Task AppendAsync(EngineEvent @event);

    /// <summary>
    /// Atomically append one or more events and persist the checkpoint that reflects them, so
    /// resuming from the checkpoint can never duplicate the effects the events describe.
    /// </summary>
    /// <exception cref="PortError">The events/checkpoint could not be durably persisted.</exception>
    Task AppendWithCheckpointAsync(IReadOnlyList<EngineEvent> events, EngineCheckpoint checkpoint);
}

/// <summary>Runs a host side effect after a turn commits successfully (for example, updating usage counters).</summary>
public interface IEnginePostCommitPort
{
    /// <exception cref="PortError">The post-commit effect failed. This is reported non-fatally on
    /// <see cref="TurnEngineResult.PostCommitError"/> — it never uncommits the turn.</exception>
    Task AfterCommitAsync(string effectId, TurnCommit commit, CancellationToken cancellationToken);
}

/// <summary>Supplies deterministic or live timestamps for engine events and checkpoints.</summary>
public interface IEngineClock
{
    /// <summary>Returns the current timestamp, formatted however the host's durable log expects.</summary>
    string Now();
}

/// <summary>Supplies deterministic or live identifiers for engine events, checkpoints, runs, and invocations.</summary>
public interface IEngineIdGenerator
{
    /// <summary>Returns a new identifier for the given identifier kind (for example, "event", "checkpoint", "run").</summary>
    string NextId(string kind);
}

// -----------------------------------------------------------------------
// Default / no-op port implementations, mirroring ports.rs.
// -----------------------------------------------------------------------

/// <summary>Permission port that approves every tool request. For hosts that explicitly allow all tools.</summary>
public sealed class AllowAllPermissionsPort : IEnginePermissionPort
{
    public Task<EnginePermissionDecision> AuthorizeAsync(ModelToolRequest request, CancellationToken cancellationToken) =>
        Task.FromResult(new EnginePermissionDecision { Approved = true, Reason = "allow_all" });
}

/// <summary>Durability port for explicitly non-durable execution profiles. Persists nothing.</summary>
public sealed class NoopDurabilityPort : IEngineDurabilityPort
{
    public Task AppendAsync(EngineEvent @event) => Task.CompletedTask;

    public Task AppendWithCheckpointAsync(IReadOnlyList<EngineEvent> events, EngineCheckpoint checkpoint) => Task.CompletedTask;
}

/// <summary>Post-commit port that performs no side effect.</summary>
public sealed class NoopPostCommitPort : IEnginePostCommitPort
{
    public Task AfterCommitAsync(string effectId, TurnCommit commit, CancellationToken cancellationToken) => Task.CompletedTask;
}

/// <summary>Model stream port that drops every chunk.</summary>
public sealed class NoopModelStreamPort : IEngineModelStreamPort
{
    public Task EmitAsync(ModelStreamChunk chunk) => Task.CompletedTask;
}

/// <summary>Builds the canonical snapshot without adding external context candidates.</summary>
public sealed class PassthroughEngineContextPort : IEngineContextPort
{
    public Task<ModelInvocationContextSnapshot> PrepareAsync(ContextRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new ModelInvocationContextSnapshot
        {
            Id = $"context:{request.InvocationId}",
            SessionId = request.SessionId,
            TurnId = request.TurnId,
            InvocationId = request.InvocationId,
            Iteration = request.Iteration,
            Messages = [.. request.Messages],
            Decisions = [],
            StablePrefixMessages = request.StablePrefixMessages,
            ContextState = request.ContextState,
        });
    }
}

/// <summary>Host policy port that leaves messages, stable prefix, and final output unchanged.</summary>
public sealed class NoopHostPolicyPort : IEngineHostPolicyPort
{
    public Task<HostPolicyResult> BeforeModelAsync(HostPolicyRequest request, CancellationToken cancellationToken) =>
        Task.FromResult(new HostPolicyResult
        {
            Messages = request.Messages,
            StablePrefixMessages = request.StablePrefixMessages,
        });

    public Task<FinalOutputPolicyResult> BeforeCommitAsync(FinalOutputPolicyRequest request, CancellationToken cancellationToken) =>
        Task.FromResult(new FinalOutputPolicyResult { Output = request.Output });
}

/// <summary>Retry policy with no delay and no side effects.</summary>
public sealed class NoopRetryPolicyPort : IEngineRetryPolicyPort
{
    public Task BackoffAsync(RetryPolicyRequest request, CancellationToken cancellationToken) => Task.CompletedTask;
}

/// <summary>Provider-neutral fallback that preserves assistant messages and appends ordered tool result messages.</summary>
public sealed class DefaultConversationPort : IEngineConversationPort
{
    public IList<Message> FormatToolExchange(ModelInvocationResponse response, IReadOnlyList<ModelToolResult> results)
    {
        var messages = new List<Message>(response.AssistantMessages ?? []);
        foreach (var request in response.ToolRequests ?? [])
        {
            var result = results.FirstOrDefault(r => r.RequestId == request.Id);
            if (result is not null)
            {
                messages.Add(Message.ToolResult(request.Id, result.ModelText()));
            }
        }

        return messages;
    }
}

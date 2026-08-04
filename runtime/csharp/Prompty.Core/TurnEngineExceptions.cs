// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Error raised by a runtime-local engine port (model, tool, permission, host policy,
/// retry policy, post-commit, or durability). Mirrors the Rust reference's
/// <c>PortError</c>: a plain message plus two orthogonal signal flags that change how
/// the canonical <see cref="TurnEngine"/> state machine reacts to the failure.
/// </summary>
public class PortError : Exception
{
    /// <summary>
    /// True when the effect's real-world outcome cannot be determined (for example, a
    /// network timeout after a tool call may have already been dispatched). The engine
    /// treats this as a signal to stop and require explicit reconciliation rather than
    /// retrying or failing outright, since retrying could duplicate a side effect.
    /// </summary>
    public bool OutcomeUnknown { get; }

    /// <summary>
    /// True when the failure reflects a host misconfiguration (for example, an unknown
    /// tool name) rather than a transient runtime failure. Configuration errors are not
    /// retried and are surfaced as a distinct commit failure kind.
    /// </summary>
    public bool ConfigurationError { get; }

    /// <summary>Optional structured metadata describing the failure.</summary>
    public IDictionary<string, object?>? Metadata { get; }

    public PortError(
        string message,
        bool outcomeUnknown = false,
        bool configurationError = false,
        IDictionary<string, object?>? metadata = null)
        : base(message)
    {
        OutcomeUnknown = outcomeUnknown;
        ConfigurationError = configurationError;
        Metadata = metadata;
    }

    /// <summary>Create a port error whose effect outcome is unknown and requires reconciliation.</summary>
    public static PortError Indeterminate(string message, IDictionary<string, object?>? metadata = null) =>
        new(message, outcomeUnknown: true, metadata: metadata);

    /// <summary>Create a port error that reflects a host misconfiguration.</summary>
    public static PortError Configuration(string message) => new(message, configurationError: true);
}

/// <summary>
/// Error raised by <see cref="IEngineHostPolicyPort"/>. Unlike <see cref="PortError"/>,
/// host policy failures always carry an explicit <see cref="ErrorKind"/> that the engine
/// forwards verbatim into the committed failure output.
/// </summary>
public class HostPolicyException : Exception
{
    /// <summary>Machine-readable failure category surfaced on the committed turn output.</summary>
    public string ErrorKind { get; }

    public HostPolicyException(string errorKind, string message)
        : base(message)
    {
        ErrorKind = errorKind;
    }
}

/// <summary>
/// Base type for errors that prevent the canonical <see cref="TurnEngine"/> from producing
/// a committed <see cref="TurnEngineResult"/> at all. These are distinct from ordinary
/// turn outcomes (success, cancelled, failed, reconciliation-required), which are all
/// returned as a normal <see cref="TurnEngineResult"/> rather than thrown.
/// </summary>
public abstract class TurnEngineException : Exception
{
    protected TurnEngineException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}

/// <summary>Thrown when a <see cref="TurnEngineRequest"/> or resume record fails validation.</summary>
public sealed class TurnEngineInvalidRequestException : TurnEngineException
{
    public TurnEngineInvalidRequestException(string message)
        : base($"invalid turn request: {message}")
    {
    }
}

/// <summary>
/// Thrown when appending a single, non-checkpointed event to the durability port fails
/// (for example, the plain <c>TurnStarted</c> or <c>ContextPrepared</c> events). This is
/// unrecoverable for the current run because no checkpoint was persisted to resume from.
/// </summary>
public sealed class TurnEnginePortException : TurnEngineException
{
    /// <summary>The engine stage that failed (for example, "event journal").</summary>
    public string Stage { get; }

    public TurnEnginePortException(string stage, PortError source)
        : base($"{stage} failed: {source.Message}", source)
    {
        Stage = stage;
    }
}

/// <summary>
/// Thrown when an atomic append-with-checkpoint durability write fails while persisting a
/// semantic effect (policy update, model response, tool result, tool exchange, or
/// reconciliation). The caller can use <see cref="Checkpoint"/> and <see cref="ToolResults"/>
/// to recover: the in-memory effect already happened, but it was never durably recorded,
/// so a host must decide how to reconcile before resuming.
/// </summary>
public sealed class TurnEngineRecoveryRequiredException : TurnEngineException
{
    /// <summary>The persistence stage that failed (for example, "tool result").</summary>
    public string Stage { get; }

    /// <summary>Identifier of the effect that could not be durably recorded.</summary>
    public string RequestId { get; }

    /// <summary>The checkpoint that was built but never durably appended.</summary>
    public EngineCheckpoint Checkpoint { get; }

    /// <summary>Tool results completed so far in this run, for host-side recovery bookkeeping.</summary>
    public IReadOnlyList<ModelToolResult> ToolResults { get; }

    public TurnEngineRecoveryRequiredException(
        string stage,
        string requestId,
        EngineCheckpoint checkpoint,
        IReadOnlyList<ModelToolResult> toolResults,
        PortError source)
        : base($"{stage} durability failed after effect '{requestId}': {source.Message}", source)
    {
        Stage = stage;
        RequestId = requestId;
        Checkpoint = checkpoint;
        ToolResults = toolResults;
    }
}

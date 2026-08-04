// Copyright (c) Microsoft. All rights reserved.

namespace Prompty.Core;

/// <summary>
/// Request accepted by the canonical <see cref="TurnEngine"/>. Mirrors the Rust reference's
/// <c>TurnEngineRequest</c> (runtime/rust/prompty/src/engine/turn.rs) field for field. A fresh
/// turn is built with <see cref="TurnEngineRequest(string, string, IList{Message})"/>; an
/// interrupted turn is resumed with <see cref="ResumeFrom"/>/<see cref="FromResume"/> and the
/// reconciliation-specific resume factories.
/// </summary>
public sealed class TurnEngineRequest
{
    public TurnEngineRequest(string sessionId, string turnId, IList<Message> messages)
    {
        SessionId = sessionId;
        TurnId = turnId;
        Messages = messages;
        StablePrefixMessages = messages.Count;
    }

    /// <summary>Session this turn belongs to.</summary>
    public string SessionId { get; set; }

    /// <summary>Turn identifier, unique within the session.</summary>
    public string TurnId { get; set; }

    /// <summary>Stable identifier of this engine run. Empty means the engine assigns one at run start.</summary>
    public string RunId { get; set; } = string.Empty;

    /// <summary>Run identifier of the parent run when this run was delegated.</summary>
    public string? ParentRunId { get; set; }

    /// <summary>Zero-based delegation nesting depth; 0 for a top-level run.</summary>
    public int DelegationDepth { get; set; }

    /// <summary>Conversation messages seen so far.</summary>
    public IList<Message> Messages { get; set; }

    /// <summary>Opaque turn inputs, echoed into context snapshots and host policy requests.</summary>
    public object? Inputs { get; set; }

    /// <summary>Maximum number of model/tool iterations permitted for this run.</summary>
    public int MaxIterations { get; set; } = 10;

    /// <summary>Maximum model invocation attempts per iteration before failing the turn.</summary>
    public int MaxModelAttempts { get; set; } = 3;

    /// <summary>Iteration to execute first. Non-zero values are used when resuming a checkpoint.</summary>
    public int StartIteration { get; set; }

    /// <summary>Last committed event sequence before this run.</summary>
    public long InitialSequence { get; set; }

    /// <summary>Number of leading messages the engine and host policy must not rewrite.</summary>
    public int StablePrefixMessages { get; set; }

    /// <summary>Whether the provider-side context can be reconstructed from <see cref="Messages"/> alone.</summary>
    public InvocationContextPortability Portability { get; set; } = InvocationContextPortability.Portable;

    /// <summary>Opaque references to delegated provider-side state, required when <see cref="Portability"/> is not portable.</summary>
    public IList<DelegatedStateReference> DelegatedState { get; set; } = [];

    /// <summary>Invocation id in progress when this request was built, if any.</summary>
    public string? ActiveInvocationId { get; set; }

    /// <summary>Tool requests from the most recent model response not yet executed.</summary>
    public IList<ModelToolRequest> PendingToolRequests { get; set; } = [];

    /// <summary>Tool results already committed for the in-flight model/tool exchange.</summary>
    public IList<ModelToolResult> CompletedToolResults { get; set; } = [];

    /// <summary>Number of model iterations completed so far.</summary>
    public int CompletedModelIterations { get; set; }

    /// <summary>Whether the turn is blocked pending an explicit reconciliation resolution.</summary>
    public bool ReconciliationRequired { get; set; }

    /// <summary>Durable reconciliation state for an indeterminate model invocation, if any.</summary>
    public ModelReconciliationState? ModelReconciliation { get; set; }

    /// <summary>Output pending final host policy application.</summary>
    public object? PendingOutput { get; set; }

    /// <summary>Whether a model response with no further tool requests is ready to commit.</summary>
    public bool FinalOutputReady { get; set; }

    /// <summary>Model response awaiting completion of its tool exchange.</summary>
    public ModelInvocationResponse? PendingModelResponse { get; set; }

    /// <summary>Whether host policy has already been applied for the current iteration (skip re-applying once).</summary>
    public bool PolicyAppliedForIteration { get; set; }

    /// <summary>Resolved tool result supplied when resuming after an indeterminate tool effect.</summary>
    public ModelToolResult? ReconciliationResolution { get; set; }

    /// <summary>Resolved model response supplied when resuming after an indeterminate model invocation.</summary>
    public ModelInvocationResponse? ModelReconciliationResolution { get; set; }

    /// <summary>Set the stable run identifier for this run. An empty value lets the engine assign one at run start.</summary>
    public TurnEngineRequest WithRunId(string runId)
    {
        RunId = runId;
        return this;
    }

    /// <summary>
    /// Mark this run as delegated from a parent run, carrying the parent run identifier and
    /// nesting one level deeper than the parent.
    /// </summary>
    public TurnEngineRequest DelegatedUnder(string parentRunId, int parentDelegationDepth)
    {
        ParentRunId = parentRunId;
        DelegationDepth = parentDelegationDepth + 1;
        return this;
    }

    /// <summary>Resume while continuing a journal whose tail may follow the checkpoint.</summary>
    public static TurnEngineRequest ResumeFrom(EngineCheckpoint checkpoint, int maxIterations, long lastJournalSequence)
    {
        var noPendingWork = (checkpoint.PendingToolRequests is null || checkpoint.PendingToolRequests.Count == 0)
            && checkpoint.PendingModelResponse is null
            && !checkpoint.FinalOutputReady
            && !checkpoint.ReconciliationRequired;
        var startIteration = checkpoint.ResumeSameIteration
            ? checkpoint.Iteration
            : noPendingWork ? checkpoint.Iteration + 1 : checkpoint.Iteration;

        return new TurnEngineRequest(checkpoint.SessionId, checkpoint.TurnId, [.. checkpoint.Messages])
        {
            RunId = checkpoint.RunId,
            ParentRunId = checkpoint.ParentRunId,
            DelegationDepth = checkpoint.DelegationDepth,
            StablePrefixMessages = checkpoint.StablePrefixMessages,
            Inputs = checkpoint.Inputs,
            MaxIterations = maxIterations,
            MaxModelAttempts = 3,
            StartIteration = startIteration,
            InitialSequence = Math.Max(lastJournalSequence, checkpoint.LastSequence),
            Portability = checkpoint.ContextState.Portability,
            DelegatedState = checkpoint.ContextState.DelegatedState is null ? [] : [.. checkpoint.ContextState.DelegatedState],
            ActiveInvocationId = checkpoint.ActiveInvocationId,
            PendingToolRequests = checkpoint.PendingToolRequests is null ? [] : [.. checkpoint.PendingToolRequests],
            CompletedToolResults = checkpoint.CompletedToolResults is null ? [] : [.. checkpoint.CompletedToolResults],
            CompletedModelIterations = checkpoint.CompletedModelIterations,
            ReconciliationRequired = checkpoint.ReconciliationRequired,
            ModelReconciliation = checkpoint.ModelReconciliation,
            PendingOutput = checkpoint.PendingOutput,
            FinalOutputReady = checkpoint.FinalOutputReady,
            PendingModelResponse = checkpoint.PendingModelResponse,
            PolicyAppliedForIteration = checkpoint.PolicyAppliedForIteration,
            ReconciliationResolution = null,
            ModelReconciliationResolution = null,
        };
    }

    /// <summary>
    /// Resume after the host resolves an indeterminate tool effect. Patches the checkpoint's
    /// completed tool result and, if the conversation batch was already flushed, the matching
    /// tool-result message, then resumes from the patched checkpoint.
    /// </summary>
    /// <exception cref="TurnEngineInvalidRequestException">
    /// The checkpoint does not require tool reconciliation, the resolved result is still
    /// indeterminate, or the checkpoint has no matching indeterminate tool request.
    /// </exception>
    public static TurnEngineRequest ResumeAfterReconciliation(
        EngineCheckpoint checkpoint,
        int maxIterations,
        long lastJournalSequence,
        ModelToolResult resolvedResult)
    {
        if (!checkpoint.ReconciliationRequired)
        {
            throw new TurnEngineInvalidRequestException("checkpoint does not require reconciliation");
        }

        if (checkpoint.ModelReconciliation is not null)
        {
            throw new TurnEngineInvalidRequestException(
                "checkpoint requires model reconciliation, not tool reconciliation");
        }

        if (resolvedResult.Outcome == ModelToolOutcome.Indeterminate)
        {
            throw new TurnEngineInvalidRequestException("resolved tool result must have a determinate outcome");
        }

        var resolved = CloneForPatch(checkpoint);
        var results = resolved.CompletedToolResults ??= [];
        var index = IndexOfToolResult(results, resolvedResult.RequestId);
        if (index < 0)
        {
            throw new TurnEngineInvalidRequestException(
                $"checkpoint does not contain indeterminate tool request '{resolvedResult.RequestId}'");
        }

        if (results[index].Outcome != ModelToolOutcome.Indeterminate)
        {
            throw new TurnEngineInvalidRequestException(
                $"tool request '{resolvedResult.RequestId}' is already determinate");
        }

        results[index] = resolvedResult;

        if (resolved.PendingModelResponse is null)
        {
            var messageIndex = IndexOfToolResultMessage(resolved.Messages, resolvedResult.RequestId);
            if (messageIndex < 0)
            {
                throw new TurnEngineInvalidRequestException(
                    $"checkpoint is missing the tool result message for '{resolvedResult.RequestId}'");
            }

            resolved.Messages[messageIndex] = Message.ToolResult(resolvedResult.RequestId, resolvedResult.ModelText());
        }

        resolved.ReconciliationRequired = false;

        var request = ResumeFrom(resolved, maxIterations, lastJournalSequence);
        request.ReconciliationResolution = resolvedResult;
        return request;
    }

    /// <summary>
    /// Resume after the host resolves an indeterminate model invocation, replaying the same
    /// iteration with the resolved response instead of re-invoking the model.
    /// </summary>
    /// <exception cref="TurnEngineInvalidRequestException">
    /// The checkpoint does not require model reconciliation, or the reconciliation's invocation
    /// id no longer matches the checkpoint's active invocation.
    /// </exception>
    public static TurnEngineRequest ResumeAfterModelReconciliation(
        EngineCheckpoint checkpoint,
        int maxIterations,
        long lastJournalSequence,
        ModelInvocationResponse resolvedResponse)
    {
        if (!checkpoint.ReconciliationRequired)
        {
            throw new TurnEngineInvalidRequestException("checkpoint does not require reconciliation");
        }

        var reconciliation = checkpoint.ModelReconciliation
            ?? throw new TurnEngineInvalidRequestException(
                "checkpoint requires tool reconciliation, not model reconciliation");

        if (checkpoint.ActiveInvocationId != reconciliation.InvocationId)
        {
            throw new TurnEngineInvalidRequestException(
                "model reconciliation identity does not match the active invocation");
        }

        var request = ResumeFrom(checkpoint, maxIterations, lastJournalSequence);
        request.StartIteration = checkpoint.Iteration;
        request.ReconciliationRequired = false;
        request.ModelReconciliationResolution = resolvedResponse;
        return request;
    }

    /// <summary>
    /// Build a resume request from the durable generated <see cref="ResumeContext"/>. Threads
    /// <see cref="ResumeContext.MaxModelAttempts"/> from the durable record rather than
    /// defaulting it. Use the reconciliation-specific overloads when the checkpoint is blocked
    /// pending a resolved model or tool outcome.
    /// </summary>
    public static TurnEngineRequest FromResume(ResumeContext resume)
    {
        var request = ResumeFrom(
            resume.Checkpoint,
            Math.Max(resume.MaxIterations, 0),
            Math.Max(resume.ResumeSequence(), 0));
        request.ApplyResumeAttempts(resume);
        return request;
    }

    /// <summary>
    /// Build a resume request from a <see cref="ResumeContext"/> after the host resolves an
    /// indeterminate tool effect recorded in the checkpoint.
    /// </summary>
    public static TurnEngineRequest FromResumeAfterReconciliation(ResumeContext resume, ModelToolResult resolvedResult)
    {
        var request = ResumeAfterReconciliation(
            resume.Checkpoint,
            Math.Max(resume.MaxIterations, 0),
            Math.Max(resume.ResumeSequence(), 0),
            resolvedResult);
        request.ApplyResumeAttempts(resume);
        return request;
    }

    /// <summary>
    /// Build a resume request from a <see cref="ResumeContext"/> after the host resolves an
    /// indeterminate model invocation recorded in the checkpoint.
    /// </summary>
    public static TurnEngineRequest FromResumeAfterModelReconciliation(
        ResumeContext resume,
        ModelInvocationResponse resolvedResponse)
    {
        var request = ResumeAfterModelReconciliation(
            resume.Checkpoint,
            Math.Max(resume.MaxIterations, 0),
            Math.Max(resume.ResumeSequence(), 0),
            resolvedResponse);
        request.ApplyResumeAttempts(resume);
        return request;
    }

    private void ApplyResumeAttempts(ResumeContext resume)
    {
        if (resume.MaxModelAttempts > 0)
        {
            MaxModelAttempts = resume.MaxModelAttempts;
        }
    }

    private static int IndexOfToolResult(IList<ModelToolResult> results, string requestId)
    {
        for (var i = 0; i < results.Count; i++)
        {
            if (results[i].RequestId == requestId)
            {
                return i;
            }
        }

        return -1;
    }

    private static int IndexOfToolResultMessage(IList<Message> messages, string requestId)
    {
        for (var i = 0; i < messages.Count; i++)
        {
            if (messages[i].Metadata.TryGetValue("tool_call_id", out var value) &&
                value is string toolCallId && toolCallId == requestId)
            {
                return i;
            }
        }

        return -1;
    }

    /// <summary>
    /// Shallow-clone a checkpoint's mutable collections so reconciliation patching never
    /// mutates the caller's original checkpoint instance.
    /// </summary>
    private static EngineCheckpoint CloneForPatch(EngineCheckpoint checkpoint) => new()
    {
        Id = checkpoint.Id,
        SessionId = checkpoint.SessionId,
        TurnId = checkpoint.TurnId,
        RunId = checkpoint.RunId,
        ParentRunId = checkpoint.ParentRunId,
        DelegationDepth = checkpoint.DelegationDepth,
        Iteration = checkpoint.Iteration,
        LastSequence = checkpoint.LastSequence,
        Messages = [.. checkpoint.Messages],
        StablePrefixMessages = checkpoint.StablePrefixMessages,
        Inputs = checkpoint.Inputs,
        ActiveInvocationId = checkpoint.ActiveInvocationId,
        PendingToolRequests = checkpoint.PendingToolRequests is null ? null : [.. checkpoint.PendingToolRequests],
        CompletedToolResults = checkpoint.CompletedToolResults is null ? null : [.. checkpoint.CompletedToolResults],
        CompletedModelIterations = checkpoint.CompletedModelIterations,
        ReconciliationRequired = checkpoint.ReconciliationRequired,
        ModelReconciliation = checkpoint.ModelReconciliation,
        PendingOutput = checkpoint.PendingOutput,
        FinalOutputReady = checkpoint.FinalOutputReady,
        PendingModelResponse = checkpoint.PendingModelResponse,
        ResumeSameIteration = checkpoint.ResumeSameIteration,
        PolicyAppliedForIteration = checkpoint.PolicyAppliedForIteration,
        ContextState = checkpoint.ContextState,
        Metadata = checkpoint.Metadata,
    };
}

import "@typra/emitter";
import "../conversation/message.tsp";
import "../model/usage.tsp";
import "./invocation.tsp";

namespace Prompty;

/**
 * Stable semantic event kinds emitted by the live turn engine.
 *
 * This vocabulary is intentionally finer-grained than SessionEventType: it
 * describes each model/tool round inside a single turn. Ephemeral streaming
 * token deltas are NOT events and are modeled separately as StreamChunk.
 */
alias EngineEventKind =
  | "turn_started"
  | "policy_applied"
  | "context_prepared"
  | "model_invocation_started"
  | "model_invocation_completed"
  | "model_invocation_failed"
  | "model_reconciliation_required"
  | "model_invocation_reconciled"
  | "permission_requested"
  | "permission_resolved"
  | "tool_execution_started"
  | "tool_execution_completed"
  | "tool_result_committed"
  | "tool_result_reconciled"
  | "conversation_updated"
  | "checkpoint_created"
  | "turn_committed"
  | "turn_cancelled"
  | "turn_failed"
  | "turn_reconciliation_required"
  | "post_commit_started"
  | "post_commit_completed"
  | "post_commit_failed";

/**
 * One event in the monotonic semantic event stream of a turn.
 *
 * Events are the durable, replayable record a DurabilityPort persists. Run
 * identity links delegated (nested) engine runs to their parent for
 * cross-run observability.
 */
model EngineEvent {
  @doc("Monotonic sequence number within the run, starting at one")
  sequence: int64;

  @doc("Stable unique identifier for this event")
  @sample(#{ id: "evt_abc123" })
  id: string;

  @doc("RFC 3339 timestamp when the event was emitted")
  @sample(#{ timestamp: "2025-01-01T00:00:00Z" })
  timestamp: string;

  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId: string;

  @doc("Stable turn identifier")
  @sample(#{ turnId: "turn_abc123" })
  turnId: string;

  @doc("Stable identifier of this engine run")
  @sample(#{ runId: "run_abc123" })
  runId: string;

  @doc("Run identifier of the parent run when this run was delegated")
  parentRunId?: string;

  @doc("Zero-based delegation nesting depth; 0 for a top-level run")
  delegationDepth: int32 = 0;

  @doc("Model invocation identifier, when the event belongs to an invocation")
  invocationId?: string;

  @doc("Zero-based model loop iteration, when applicable")
  iteration?: int32;

  @doc("Semantic kind of this event")
  kind: EngineEventKind;

  @doc("Opaque event-specific payload")
  payload?: unknown;
}

/**
 * Durable state required to reconcile one indeterminate model invocation.
 *
 * Retained when a model effect completed with an unknown outcome so a resumed
 * run can determine success or failure without re-invoking the provider.
 */
model ModelReconciliationState {
  @doc("Model invocation identifier awaiting reconciliation")
  @sample(#{ invocationId: "inv_abc123" })
  invocationId: string;

  @doc("The request whose outcome must be reconciled")
  request: ModelInvocationRequest;

  @doc("Zero-based attempt number that failed with an unknown outcome")
  failedAttempt: int32;

  @doc("Human-readable reason the outcome is indeterminate")
  @sample(#{ message: "provider connection dropped after request was sent" })
  message: string;

  @doc("Opaque host-specific reconciliation metadata")
  metadata?: Record<unknown> = #{};
}

/**
 * A permission decision for one tool request.
 */
model EnginePermissionDecision {
  @doc("Whether the tool request is authorized to execute")
  approved: boolean;

  @doc("Human-readable reason for the decision")
  reason?: string;

  @doc("Opaque host-specific permission metadata")
  metadata?: Record<unknown> = #{};
}

/**
 * Portable durable checkpoint emitted after a committed model/tool round.
 *
 * A resumed run rebuilt from a checkpoint MUST NOT duplicate a model or tool
 * effect that the checkpoint already records as committed. Run identity is
 * carried so delegated runs checkpoint independently under their own run.
 */
model EngineCheckpoint {
  @doc("Stable unique identifier for this checkpoint")
  @sample(#{ id: "ckpt_abc123" })
  id: string;

  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId: string;

  @doc("Stable turn identifier")
  @sample(#{ turnId: "turn_abc123" })
  turnId: string;

  @doc("Stable identifier of this engine run")
  @sample(#{ runId: "run_abc123" })
  runId: string;

  @doc("Run identifier of the parent run when this run was delegated")
  parentRunId?: string;

  @doc("Zero-based delegation nesting depth; 0 for a top-level run")
  delegationDepth: int32 = 0;

  @doc("Zero-based model loop iteration captured by this checkpoint")
  iteration: int32;

  @doc("Last committed event sequence included in this checkpoint")
  lastSequence: int64;

  @doc("Canonical conversation messages at checkpoint time")
  messages: Message[] = #[];

  @doc("Number of leading messages eligible for provider prefix-cache reuse")
  stablePrefixMessages: int32 = 0;

  @doc("Turn inputs captured for deterministic resume")
  inputs?: unknown;

  @doc("Active model invocation identifier, when one is in flight")
  activeInvocationId?: string;

  @doc("Tool requests awaiting execution or commitment")
  pendingToolRequests?: ModelToolRequest[] = #[];

  @doc("Tool results already executed in this round")
  completedToolResults?: ModelToolResult[] = #[];

  @doc("Number of fully completed model iterations")
  completedModelIterations: int32 = 0;

  @doc("Whether the turn is blocked pending model outcome reconciliation")
  reconciliationRequired: boolean = false;

  @doc("Typed provider state when model outcome reconciliation is required")
  modelReconciliation?: ModelReconciliationState;

  @doc("Final output pending commit, when computed")
  pendingOutput?: unknown;

  @doc("Whether the final output is ready to commit")
  finalOutputReady: boolean = false;

  @doc("Model response retained until all tool results form one conversation batch")
  pendingModelResponse?: ModelInvocationResponse;

  @doc("Resume this exact iteration because the checkpoint precedes an external model effect")
  resumeSameIteration: boolean = false;

  @doc("Whether the host policy rewrite is already durable for this iteration")
  policyAppliedForIteration: boolean = false;

  @doc("Provider-context state carried by this checkpoint")
  contextState: InvocationContextState;

  @doc("Opaque host-specific checkpoint metadata")
  metadata?: Record<unknown> = #{};
}

/**
 * Input that drives resuming a turn from a durable checkpoint.
 *
 * A host supplies this to restart an interrupted turn without duplicating a
 * committed model or tool effect.
 */
model ResumeContext {
  @doc("Checkpoint to resume from")
  checkpoint: EngineCheckpoint;

  @doc("Maximum model loop iterations permitted for the resumed run")
  maxIterations: int32;

  @doc("Maximum model attempts permitted per invocation in the resumed run")
  maxModelAttempts: int32;

  @doc("Last durably persisted journal sequence when the journal tail is ahead of the checkpoint; the resumed run continues numbering after this value. Zero resumes from the checkpoint's own lastSequence.")
  @sample(#{ lastJournalSequence: 12 })
  lastJournalSequence: int64 = 0;

  @doc("Opaque host-specific resume metadata")
  metadata?: Record<unknown> = #{};
}

/**
 * Terminal status of a turn.
 */
alias EngineTurnStatus =
  | "success"
  | "failed"
  | "cancelled"
  | "reconciliation_required";

/**
 * The committed outcome of a turn handed to post-commit consumers.
 */
model TurnCommit {
  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId: string;

  @doc("Stable turn identifier")
  @sample(#{ turnId: "turn_abc123" })
  turnId: string;

  @doc("Terminal status of the turn")
  status: EngineTurnStatus;

  @doc("Final output when the turn succeeded")
  output?: unknown;

  @doc("Canonical conversation messages at commit time")
  messages: Message[] = #[];

  @doc("Number of model loop iterations executed")
  iterations: int32;

  @doc("Last committed event sequence for the turn")
  lastSequence: int64;

  @doc("Provider-context state carried out of the turn")
  contextState: InvocationContextState;

  @doc("Typed provider state when the commit requires model reconciliation")
  modelReconciliation?: ModelReconciliationState;
}

/**
 * The result returned by the turn engine.
 */
model TurnEngineResult {
  @doc("The committed turn outcome")
  commit: TurnCommit;

  @doc("Immutable context snapshots produced during the turn")
  snapshots?: ModelInvocationContextSnapshot[] = #[];

  @doc("Normalized tool results produced during the turn")
  toolResults?: ModelToolResult[] = #[];

  @doc("A non-fatal post-commit failure; the turn itself remains committed")
  postCommitError?: string;
}

/**
 * Host-owned deterministic state supplied before one model invocation.
 */
model HostPolicyRequest {
  @doc("Stable session identifier")
  sessionId: string;

  @doc("Stable turn identifier")
  turnId: string;

  @doc("Zero-based model loop iteration")
  iteration: int32;

  @doc("Canonical messages entering the invocation")
  messages: Message[] = #[];

  @doc("Number of leading messages eligible for provider prefix-cache reuse")
  stablePrefixMessages: int32 = 0;

  @doc("Turn inputs")
  inputs?: unknown;
}

/**
 * State rewrite produced by the host policy before a model invocation.
 */
model HostPolicyResult {
  @doc("Canonical messages to use for the invocation")
  messages: Message[] = #[];

  @doc("Number of leading messages eligible for provider prefix-cache reuse")
  stablePrefixMessages: int32 = 0;

  @doc("Opaque host-specific policy metadata")
  metadata?: Record<unknown> = #{};
}

/**
 * Final output supplied to the host policy immediately before a success commit.
 */
model FinalOutputPolicyRequest {
  @doc("Stable session identifier")
  sessionId: string;

  @doc("Stable turn identifier")
  turnId: string;

  @doc("Zero-based model loop iteration")
  iteration: int32;

  @doc("Canonical messages at commit time")
  messages: Message[] = #[];

  @doc("Proposed final output")
  output?: unknown;

  @doc("Turn inputs")
  inputs?: unknown;
}

/**
 * Final output rewrite produced by the host policy before commit.
 */
model FinalOutputPolicyResult {
  @doc("Rewritten final output")
  output?: unknown;

  @doc("Opaque host-specific policy metadata")
  metadata?: Record<unknown> = #{};
}

/**
 * Context supplied to the retry policy after a retryable model failure.
 */
model RetryPolicyRequest {
  @doc("Number of failures observed for this invocation, starting at one")
  failedAttempts: int32;

  @doc("One-based attempt number that will run after backoff")
  nextAttempt: int32;

  @doc("Maximum attempts permitted for the invocation")
  maxAttempts: int32;

  @doc("Human-readable reason for the retry")
  reason: string;
}

/**
 * Planning input handed to the context pipeline before one model invocation.
 */
model ContextRequest {
  @doc("Stable session identifier")
  sessionId: string;

  @doc("Stable turn identifier")
  turnId: string;

  @doc("Stable model invocation identifier")
  invocationId: string;

  @doc("Zero-based model loop iteration")
  iteration: int32;

  @doc("Canonical messages entering context planning")
  messages: Message[] = #[];

  @doc("Number of leading messages eligible for provider prefix-cache reuse")
  stablePrefixMessages: int32 = 0;

  @doc("Provider-context state entering this invocation")
  contextState: InvocationContextState;

  @doc("Turn inputs")
  inputs?: unknown;
}

/**
 * A context contribution before filtering, ranking, and packing.
 */
model ContextCandidate {
  @doc("Stable candidate identifier")
  @sample(#{ id: "memory:project-plan" })
  id: string;

  @doc("Host-defined source of the candidate")
  @sample(#{ source: "memory" })
  source: string;

  @doc("Messages contributed by the candidate")
  messages: Message[] = #[];

  @doc("Opaque host-specific candidate metadata")
  metadata?: Record<unknown> = #{};
}

import "@typra/emitter";
import "./invocation.tsp";

using Prompty.Conformance.Samples;
using Prompty.Contracts.Events;
using Prompty.Contracts.Models;
namespace Prompty.Contracts.Pipeline;

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
  @sample(EngineEventIdSample)
  id: string;

  @doc("RFC 3339 timestamp when the event was emitted")
  @sample(EngineEventTimestampSample)
  timestamp: string;

  @doc("Stable session identifier")
  @sample(EngineEventSessionIdSample)
  sessionId: string;

  @doc("Stable turn identifier")
  @sample(EngineEventTurnIdSample)
  turnId: string;

  @doc("Stable identifier of this engine run")
  @sample(EngineEventRunIdSample)
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
  @sample(invocationInvocationIdSample)
  invocationId: string;

  @doc("The request whose outcome must be reconciled")
  request: ModelInvocationRequest;

  @doc("Zero-based attempt number that failed with an unknown outcome")
  failedAttempt: int32;

  @doc("Human-readable reason the outcome is indeterminate")
  @sample(invocationMessageSample)
  message: string;

  @doc("Opaque host-specific reconciliation metadata")
  metadata?: Record<unknown>;
}

/** A permission decision for one tool request. */
model EnginePermissionDecision {
  @doc("Whether the tool request is authorized to execute")
  approved: boolean;

  @doc("Human-readable reason for the decision")
  reason?: string;

  @doc("Opaque host-specific permission metadata")
  metadata?: Record<unknown>;
}

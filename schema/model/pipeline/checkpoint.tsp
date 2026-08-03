import "@typra/emitter";
import "../conversation/message.tsp";
import "./engine-events.tsp";
import "./invocation.tsp";

namespace Prompty;

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

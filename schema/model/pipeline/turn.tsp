import "@typra/emitter";
import "../events/payloads.tsp";
import "../events/session.tsp";

namespace Prompty;

/**
 * Configuration for the agent loop's turn() function. Controls iteration
 * limits, retry policy, context management, and execution behavior.
 *
 * Runtimes accept these as either a TurnOptions object or individual
 * keyword/named parameters — the TypeSpec model defines the canonical
 * field set.
 */
model TurnOptions {
  @doc("Maximum number of tool-call iterations before the loop terminates")
  @sample(#{ maxIterations: 10 })
  maxIterations?: int32 = 10;

  @doc("Maximum number of LLM call retries on transient failure within a single iteration")
  @sample(#{ maxLlmRetries: 3 })
  maxLlmRetries?: int32 = 3;

  @doc("Character budget for the context window. When set, the loop trims older messages to stay within budget before each LLM call. System messages are never dropped.")
  @sample(#{ contextBudget: 100000 })
  contextBudget?: int32;

  @doc("Whether to execute multiple tool calls concurrently when the LLM returns several in one response")
  @sample(#{ parallelToolCalls: true })
  parallelToolCalls?: boolean = false;

  @doc("When true, return the raw LLM response without processor post-processing")
  @sample(#{ raw: false })
  raw?: boolean = false;

  @doc("Turn number for trace labeling. Useful when the caller maintains an outer conversation loop.")
  @sample(#{ turn: 1 })
  turn?: int32;

  @doc("Context compaction configuration. Controls how messages are summarized when the context window exceeds the budget.")
  @sample(#{ compaction: #{ strategy: "summarize" } })
  compaction?: CompactionConfig;
}

/**
 * Configuration for context window compaction. When the message history
 * exceeds the context budget, the compaction strategy is applied to
 * reduce the message list while preserving essential information.
 */
model CompactionConfig {
  @doc("The compaction strategy identifier. Built-in strategies include 'summarize'. Can also be a path to a .prompty file used as the summarization prompt.")
  @sample(#{ strategy: "summarize" })
  strategy?: string;

  @doc("Character budget for the compacted context. Overrides TurnOptions.contextBudget when set.")
  @sample(#{ budget: 50000 })
  budget?: int32;

  @doc("Additional strategy-specific options")
  @sample(#{ options: #{ preserveSystemMessages: true } })
  options?: Record<unknown> = #{};
}

/**
 * Request passed by the reference turn runner to the injected model callback.
 *
 * The runner owns deterministic orchestration semantics; model/provider-specific
 * execution stays behind this callback boundary.
 */
model TurnModelRequest {
  @doc("Stable harness session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId: string;

  @doc("Stable turn identifier within the session")
  @sample(#{ turnId: "turn_abc123" })
  turnId: string;

  @doc("Zero-based model loop iteration")
  @sample(#{ iteration: 0 })
  iteration: int32;

  @doc("Inputs supplied to the deterministic single-turn run")
  inputs?: Record<unknown> = #{};

  @doc("Canonical turn execution options")
  options?: TurnOptions;

  @doc("Host tool results produced by the previous iteration")
  toolResults?: HostToolResult[] = #[];
}

/**
 * Response returned by the injected model callback to the reference turn runner.
 */
model TurnModelResponse {
  @doc("Provider-neutral final model output for the turn when no more tools are requested")
  output?: unknown;

  @doc("Host tool execution requests emitted by the model callback")
  toolRequests?: HostToolRequest[] = #[];

  @doc("Additional deterministic state to merge into the iteration checkpoint")
  checkpointState?: Record<unknown> = #{};
}

/**
 * Request accepted by a reference turn runner implementation.
 */
model RunTurnRequest {
  @doc("Stable harness session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId: string;

  @doc("Stable turn identifier within the session")
  @sample(#{ turnId: "turn_abc123" })
  turnId: string;

  @doc("Inputs supplied to the deterministic single-turn run")
  inputs?: Record<unknown> = #{};

  @doc("Canonical turn execution options")
  options?: TurnOptions;
}

/**
 * Final semantic status for a reference turn runner result.
 *
 * This mirrors TurnStatus but remains distinct so generators can emit stable,
 * model-local enum names without collisions.
 */
alias RunTurnStatus = "success" | "error" | "cancelled";

/**
 * Result returned by a reference turn runner implementation.
 */
model RunTurnResult {
  @doc("Stable harness session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId: string;

  @doc("Stable turn identifier within the session")
  @sample(#{ turnId: "turn_abc123" })
  turnId: string;

  @doc("Final semantic status for the deterministic turn")
  status: RunTurnStatus;

  @doc("Provider-neutral final output returned by the injected model callback")
  output?: unknown;

  @doc("Number of model loop iterations executed")
  @sample(#{ iterations: 1 })
  iterations: int32;

  @doc("Host tool results produced during the turn")
  toolResults?: HostToolResult[] = #[];

  @doc("Checkpoints created during the turn")
  checkpoints?: Checkpoint[] = #[];
}

/**
 * Stable, replay-comparable projection of a journal record.
 *
 * Runtime journal records may carry additional payload fields, durations, telemetry,
 * or provider-specific data. Replay verification compares this normalized shape so
 * deterministic orchestration semantics are mechanically shared across runtimes.
 */
model ReplayJournalRecord {
  @doc("Journal record kind")
  kind: ReplayRecordKind;

  @doc("Turn or session event type, when kind is not summary")
  type?: string;

  @doc("Stable harness session identifier")
  sessionId?: string;

  @doc("Stable turn identifier within the session")
  turnId?: string;

  @doc("Zero-based model loop iteration for turn records")
  iteration?: int32;

  @doc("Final semantic status for turn/session/summary records")
  status?: ReplayRecordStatus;

  @doc("Permission request identifier for permission request records")
  requestId?: string;

  @doc("Host tool name for tool execution/result records")
  toolName?: string;

  @doc("Whether a permission or host tool operation succeeded")
  success?: boolean;

  @doc("Stable error discriminator for failed records")
  errorKind?: string;

  @doc("Number of turns represented by a summary record")
  turns?: int32;

  @doc("Number of checkpoints represented by a summary record")
  checkpoints?: int32;
}

/**
 * Durable journal record kind.
 */
alias ReplayRecordKind = "session" | "turn" | "summary";

/**
 * Status values captured in normalized replay records.
 *
 * This mirrors RunTurnStatus but remains distinct so generators can emit stable,
 * model-local enum names without collisions.
 */
alias ReplayRecordStatus = "success" | "error" | "cancelled";

/**
 * Request accepted by a replay verifier implementation.
 */
model ReplayVerificationRequest {
  @doc("Expected normalized replay records")
  expected: ReplayJournalRecord[] = #[];

  @doc("Actual normalized replay records")
  actual: ReplayJournalRecord[] = #[];
}

/**
 * Final semantic status for replay verification.
 */
alias ReplayVerificationStatus = "passed" | "failed";

/**
 * A single mismatch produced by replay verification.
 */
model ReplayMismatch {
  @doc("Zero-based record index where the mismatch was found")
  index: int32;

  @doc("Expected record at this index, when present")
  expected?: ReplayJournalRecord;

  @doc("Actual record at this index, when present")
  actual?: ReplayJournalRecord;

  @doc("Human-readable mismatch explanation")
  message: string;
}

/**
 * Result returned by a replay verifier implementation.
 */
model ReplayVerificationResult {
  @doc("Replay verification status")
  status: ReplayVerificationStatus;

  @doc("Record mismatches, empty when verification passed")
  mismatches?: ReplayMismatch[] = #[];

  @doc("Number of expected records")
  expectedCount: int32;

  @doc("Number of actual records")
  actualCount: int32;
}

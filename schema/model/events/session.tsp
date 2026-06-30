import "@typra/emitter";
import "../model/usage.tsp";
import "./payloads.tsp";

namespace Prompty;

/**
 * The type of event emitted by an outer agent harness session. Session events
 * capture lifecycle and persistence concerns that sit below any particular UI
 * but above a single model turn.
 */
alias SessionEventType =
  | "session_start"
  | "session_end"
  | "session_warning"
  | "session_hook_start"
  | "session_hook_end"
  | "checkpoint_created"
  | "trajectory_event";

/**
 * Final semantic status for an outer harness session end event.
 */
alias SessionEndStatus = "success" | "error" | "cancelled" | "interrupted";

/**
 * Final semantic status for a summarized harness session.
 *
 * This intentionally mirrors SessionEndStatus but remains a distinct alias
 * because some language generators emit enum aliases in each model file.
 */
alias SessionSummaryStatus = "success" | "error" | "cancelled" | "interrupted";

/**
 * Execution context associated with a harness session. Host-specific
 * environments can store detailed profiles in metadata without making the core
 * contract depend on one source-control provider or workspace shape.
 */
model HarnessContext {
  @doc("Current working directory for the harness")
  @sample(#{ cwd: "/workspace/project" })
  cwd?: string;

  @doc("Git repository root, when known")
  @sample(#{ gitRoot: "/workspace/project" })
  gitRoot?: string;

  @doc("Host-defined context metadata, such as source-control or sandbox details")
  metadata?: Record<unknown>;
}

/**
 * Payload for "session_start" events.
 */
model SessionStartPayload {
  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId: string;

  @doc("Session event schema version")
  @sample(#{ schemaVersion: "1" })
  schemaVersion?: string = "1";

  @doc("Producer that started the session")
  @sample(#{ producer: "prompty-agent" })
  producer?: string;

  @doc("Runtime that produced the session")
  @sample(#{ runtime: "typescript" })
  runtime?: string;

  @doc("Prompty library version")
  @sample(#{ promptyVersion: "2.0.0" })
  promptyVersion?: string;

  @doc("ISO 8601 UTC timestamp when the session started")
  @sample(#{ startTime: "2026-06-09T20:00:00Z" })
  startTime?: string;

  @doc("Selected model identifier, when known")
  @sample(#{ selectedModel: "gpt-4o-mini" })
  selectedModel?: string;

  @doc("Selected reasoning effort or equivalent model setting, when known")
  @sample(#{ reasoningEffort: "medium" })
  reasoningEffort?: string;

  @doc("Repository and execution context")
  context?: HarnessContext;
}

/**
 * Payload for "session_end" events.
 */
model SessionEndPayload {
  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId?: string;

  @doc("Final session status")
  @sample(#{ status: "success" })
  status?: SessionEndStatus;

  @doc("Host-specific reason the session ended")
  @sample(#{ reason: "complete" })
  reason?: string;

  @doc("Total elapsed session duration in milliseconds")
  @sample(#{ durationMs: 12500 })
  durationMs?: float64;
}

/**
 * Payload for "session_warning" events.
 */
model SessionWarningPayload {
  @doc("Stable machine-readable warning category")
  @sample(#{ warningType: "remote" })
  warningType: string;

  @doc("Human-readable warning message")
  @sample(#{ message: "Remote session disabled" })
  message: string;

  @doc("Additional host-specific warning details")
  details?: Record<unknown>;
}

/**
 * A canonical event envelope emitted by an outer harness session.
 */
model SessionEvent {
  @doc("Unique identifier for this event")
  @sample(#{ id: "evt_abc123" })
  id: string;

  @doc("Event type discriminator")
  type: SessionEventType;

  @doc("ISO 8601 UTC timestamp when the event was emitted")
  @sample(#{ timestamp: "2026-06-09T20:00:00Z" })
  timestamp: string;

  @doc("Stable identifier for the outer session")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId?: string;

  @doc("Associated turn identifier, when this session event is linked to a turn")
  @sample(#{ turnId: "turn_001" })
  turnId?: string;

  @doc("Parent event or span identifier for reconstructing event hierarchy")
  @sample(#{ parentId: "evt_parent" })
  parentId?: string;

  @doc("Trace span identifier associated with this event")
  @sample(#{ spanId: "span_hook_001" })
  spanId?: string;

  @doc("Event-specific payload. Use the typed payload model matching 'type'.")
  payload: Record<unknown> = #{};

  @doc("Redaction state for sensitive payload fields")
  redaction?: RedactionMetadata;
}

/**
 * A persisted handoff point for a harness session.
 */
model Checkpoint {
  @doc("Stable checkpoint identifier")
  @sample(#{ id: "chk_abc123" })
  id?: string;

  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId?: string;

  @doc("Associated turn identifier, when the checkpoint was created inside a turn")
  @sample(#{ turnId: "turn_001" })
  turnId?: string;

  @doc("Monotonic checkpoint number within the session")
  @sample(#{ checkpointNumber: 3 })
  checkpointNumber?: int32;

  @doc("Short checkpoint title")
  @sample(#{ title: "Added harness contracts" })
  title: string;

  @doc("Short human-readable overview")
  overview?: string;

  @doc("Portable checkpoint state needed to resume or hand off the session")
  state?: Record<unknown>;

  @doc("Optional host-authored summary or handoff note")
  summary?: string;

  @doc("Host-defined checkpoint metadata")
  metadata?: Record<unknown>;

  @doc("ISO 8601 UTC timestamp when the checkpoint was created")
  @sample(#{ createdAt: "2026-06-09T20:00:00Z" })
  createdAt?: string;

  @doc("Redaction state for sensitive checkpoint fields")
  redaction?: RedactionMetadata;
}

/**
 * A compact, replay-oriented record of one harness-side action or observation.
 */
model TrajectoryEvent {
  @doc("Stable trajectory event identifier")
  @sample(#{ id: "traj_abc123" })
  id?: string;

  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId?: string;

  @doc("Associated turn identifier, when available")
  @sample(#{ turnId: "turn_001" })
  turnId?: string;

  @doc("Associated tool call identifier, when available")
  @sample(#{ toolCallId: "call_abc123" })
  toolCallId?: string;

  @doc("Zero-based turn index in the session")
  @sample(#{ turnIndex: 4 })
  turnIndex?: int32;

  @doc("Host-defined trajectory event category")
  @sample(#{ eventType: "command" })
  eventType: string;

  @doc("Sanitized event data")
  data?: Record<unknown>;

  @doc("ISO 8601 UTC timestamp when the trajectory event was recorded")
  @sample(#{ createdAt: "2026-06-09T20:00:00Z" })
  createdAt?: string;

  @doc("Redaction state for sensitive trajectory fields")
  redaction?: RedactionMetadata;
}

/**
 * A file observed or touched by a harness session.
 */
model SessionFileRef {
  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId?: string;

  @doc("File path, relative to the harness workspace when possible")
  @sample(#{ path: "src/index.ts" })
  path: string;

  @doc("Tool that first observed the file, when known")
  @sample(#{ toolName: "view" })
  toolName?: string;

  @doc("Zero-based turn index where the file was first observed")
  @sample(#{ turnIndex: 2 })
  turnIndex?: int32;

  @doc("ISO 8601 UTC timestamp when the file was first observed")
  @sample(#{ firstSeenAt: "2026-06-09T20:00:00Z" })
  firstSeenAt?: string;
}

/**
 * A non-file reference observed by a harness session.
 */
model SessionRef {
  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId?: string;

  @doc("Reference category")
  @sample(#{ refType: "issue" })
  refType: string;

  @doc("Reference value")
  @sample(#{ refValue: "owner/repo#123" })
  refValue: string;

  @doc("Zero-based turn index where the reference was first observed")
  @sample(#{ turnIndex: 2 })
  turnIndex?: int32;

  @doc("ISO 8601 UTC timestamp when the reference was recorded")
  @sample(#{ createdAt: "2026-06-09T20:00:00Z" })
  createdAt?: string;
}

/**
 * Summary statistics for a completed session trace.
 */
model SessionSummary {
  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId: string;

  @doc("Final session status")
  @sample(#{ status: "success" })
  status?: SessionSummaryStatus;

  @doc("Number of user/assistant turns in the session")
  @sample(#{ turns: 5 })
  turns?: int32;

  @doc("Number of checkpoints created")
  @sample(#{ checkpoints: 2 })
  checkpoints?: int32;

  @doc("Aggregated token usage for the session")
  usage?: TokenUsage;

  @doc("Total elapsed session duration in milliseconds")
  @sample(#{ durationMs: 12500 })
  durationMs?: float64;
}

/**
 * Portable replay container for an outer harness session.
 */
model SessionTrace {
  @doc("Trace schema version")
  @sample(#{ version: "1" })
  version: string = "1";

  @doc("Runtime name that produced the trace")
  @sample(#{ runtime: "typescript" })
  runtime?: string;

  @doc("Prompty library version that produced the trace")
  @sample(#{ promptyVersion: "2.0.0" })
  promptyVersion?: string;

  @doc("Stable session identifier")
  @sample(#{ sessionId: "sess_abc123" })
  sessionId?: string;

  @doc("Recorded session events in emission order")
  events: SessionEvent[];

  @doc("Recorded turn traces associated with the session")
  turns?: TurnTrace[];

  @doc("Checkpoints created during the session")
  checkpoints?: Checkpoint[];

  @doc("Compact trajectory records associated with the session")
  trajectory?: TrajectoryEvent[];

  @doc("Files observed or touched during the session")
  files?: SessionFileRef[];

  @doc("Non-file references observed during the session")
  refs?: SessionRef[];

  @doc("Optional summary computed from the event stream")
  summary?: SessionSummary;
}

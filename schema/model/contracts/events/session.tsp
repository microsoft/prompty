import "@typra/emitter";
import "../models/usage.tsp";
import "./payloads.tsp";

using Prompty.Conformance.Samples;
using Prompty.Contracts.Models;
using Prompty.Contracts.Tooling;
namespace Prompty.Contracts.Events;

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
  @sample(turnCwdSample)
  cwd?: string;

  @doc("Git repository root, when known")
  @sample(turnGitRootSample)
  gitRoot?: string;

  @doc("Host-defined context metadata, such as source-control or sandbox details")
  metadata?: Record<unknown>;
}

/**
 * Payload for "session_start" events.
 */
model SessionStartPayload {
  @doc("Stable session identifier")
  @sample(SessionStartPayloadSessionIdSample)
  sessionId: string;

  @doc("Session event schema version")
  @sample(SessionStartPayloadSchemaVersionSample)
  schemaVersion?: string = "1";

  @doc("Producer that started the session")
  @sample(SessionStartPayloadProducerSample)
  producer?: string;

  @doc("Runtime that produced the session")
  @sample(SessionStartPayloadRuntimeSample)
  runtime?: string;

  @doc("Prompty library version")
  @sample(SessionStartPayloadPromptyVersionSample)
  promptyVersion?: string;

  @doc("ISO 8601 UTC timestamp when the session started")
  @sample(SessionStartPayloadStartTimeSample)
  startTime?: string;

  @doc("Selected model identifier, when known")
  @sample(SessionStartPayloadSelectedModelSample)
  selectedModel?: string;

  @doc("Selected reasoning effort or equivalent model setting, when known")
  @sample(SessionStartPayloadReasoningEffortSample)
  reasoningEffort?: string;

  @doc("Repository and execution context")
  context?: HarnessContext;
}

/**
 * Payload for "session_end" events.
 */
model SessionEndPayload {
  @doc("Stable session identifier")
  @sample(SessionEndPayloadSessionIdSample)
  sessionId?: string;

  @doc("Final session status")
  @sample(SessionEndPayloadStatusSample)
  status?: SessionEndStatus;

  @doc("Host-specific reason the session ended")
  @sample(SessionEndPayloadReasonSample)
  reason?: string;

  @doc("Total elapsed session duration in milliseconds")
  @sample(SessionEndPayloadDurationMsSample)
  durationMs?: float64;
}

/**
 * Payload for "session_warning" events.
 */
model SessionWarningPayload {
  @doc("Stable machine-readable warning category")
  @sample(SessionWarningPayloadWarningTypeSample)
  warningType: string;

  @doc("Human-readable warning message")
  @sample(SessionWarningPayloadMessageSample)
  message: string;

  @doc("Additional host-specific warning details")
  details?: Record<unknown>;
}

/**
 * A canonical event envelope emitted by an outer harness session.
 */
model SessionEvent {
  @doc("Unique identifier for this event")
  @sample(SessionEventIdSample)
  id: string;

  @doc("Event type discriminator")
  type: SessionEventType;

  @doc("ISO 8601 UTC timestamp when the event was emitted")
  @sample(SessionEventTimestampSample)
  timestamp: string;

  @doc("Stable identifier for the outer session")
  @sample(SessionEventSessionIdSample)
  sessionId?: string;

  @doc("Associated turn identifier, when this session event is linked to a turn")
  @sample(SessionEventTurnIdSample)
  turnId?: string;

  @doc("Parent event or span identifier for reconstructing event hierarchy")
  @sample(SessionEventParentIdSample)
  parentId?: string;

  @doc("Trace span identifier associated with this event")
  @sample(SessionEventSpanIdSample)
  spanId?: string;

  @doc("Event-specific payload. Use the typed payload model matching 'type'.")
  payload: Record<unknown>;

  @doc("Redaction state for sensitive payload fields")
  redaction?: RedactionMetadata;
}

/**
 * A persisted handoff point for a harness session.
 */
model Checkpoint {
  @doc("Stable checkpoint identifier")
  @sample(CheckpointIdSample)
  id?: string;

  @doc("Stable session identifier")
  @sample(CheckpointSessionIdSample)
  sessionId?: string;

  @doc("Associated turn identifier, when the checkpoint was created inside a turn")
  @sample(CheckpointTurnIdSample)
  turnId?: string;

  @doc("Monotonic checkpoint number within the session")
  @sample(CheckpointCheckpointNumberSample)
  checkpointNumber?: int32;

  @doc("Short checkpoint title")
  @sample(CheckpointTitleSample)
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
  @sample(CheckpointCreatedAtSample)
  createdAt?: string;

  @doc("Redaction state for sensitive checkpoint fields")
  redaction?: RedactionMetadata;
}

/**
 * A compact, replay-oriented record of one harness-side action or observation.
 */
model TrajectoryEvent {
  @doc("Stable trajectory event identifier")
  @sample(TrajectoryEventIdSample)
  id?: string;

  @doc("Stable session identifier")
  @sample(TrajectoryEventSessionIdSample)
  sessionId?: string;

  @doc("Associated turn identifier, when available")
  @sample(TrajectoryEventTurnIdSample)
  turnId?: string;

  @doc("Associated tool call identifier, when available")
  @sample(TrajectoryEventToolCallIdSample)
  toolCallId?: string;

  @doc("Zero-based turn index in the session")
  @sample(TrajectoryEventTurnIndexSample)
  turnIndex?: int32;

  @doc("Host-defined trajectory event category")
  @sample(TrajectoryEventEventTypeSample)
  eventType: string;

  @doc("Sanitized event data")
  data?: Record<unknown>;

  @doc("ISO 8601 UTC timestamp when the trajectory event was recorded")
  @sample(TrajectoryEventCreatedAtSample)
  createdAt?: string;

  @doc("Redaction state for sensitive trajectory fields")
  redaction?: RedactionMetadata;
}

/**
 * A file observed or touched by a harness session.
 */
model SessionFileRef {
  @doc("Stable session identifier")
  @sample(SessionFileRefSessionIdSample)
  sessionId?: string;

  @doc("File path, relative to the harness workspace when possible")
  @sample(SessionFileRefPathSample)
  path: string;

  @doc("Tool that first observed the file, when known")
  @sample(SessionFileRefToolNameSample)
  toolName?: string;

  @doc("Zero-based turn index where the file was first observed")
  @sample(SessionFileRefTurnIndexSample)
  turnIndex?: int32;

  @doc("ISO 8601 UTC timestamp when the file was first observed")
  @sample(SessionFileRefFirstSeenAtSample)
  firstSeenAt?: string;
}

/**
 * A non-file reference observed by a harness session.
 */
model SessionRef {
  @doc("Stable session identifier")
  @sample(SessionRefSessionIdSample)
  sessionId?: string;

  @doc("Reference category")
  @sample(SessionRefRefTypeSample)
  refType: string;

  @doc("Reference value")
  @sample(SessionRefRefValueSample)
  refValue: string;

  @doc("Zero-based turn index where the reference was first observed")
  @sample(SessionRefTurnIndexSample)
  turnIndex?: int32;

  @doc("ISO 8601 UTC timestamp when the reference was recorded")
  @sample(SessionRefCreatedAtSample)
  createdAt?: string;
}

/**
 * Summary statistics for a completed session trace.
 */
model SessionSummary {
  @doc("Stable session identifier")
  @sample(SessionSummarySessionIdSample)
  sessionId: string;

  @doc("Final session status")
  @sample(SessionSummaryStatusSample)
  status?: SessionSummaryStatus;

  @doc("Number of user/assistant turns in the session")
  @sample(SessionSummaryTurnsSample)
  turns?: int32;

  @doc("Number of checkpoints created")
  @sample(SessionSummaryCheckpointsSample)
  checkpoints?: int32;

  @doc("Aggregated token usage for the session")
  usage?: TokenUsage;

  @doc("Total elapsed session duration in milliseconds")
  @sample(SessionSummaryDurationMsSample)
  durationMs?: float64;
}

/**
 * Portable replay container for an outer harness session.
 */
model SessionTrace {
  @doc("Trace schema version")
  @sample(SessionTraceVersionSample)
  version: string = "1";

  @doc("Runtime name that produced the trace")
  @sample(SessionTraceRuntimeSample)
  runtime?: string;

  @doc("Prompty library version that produced the trace")
  @sample(SessionTracePromptyVersionSample)
  promptyVersion?: string;

  @doc("Stable session identifier")
  @sample(SessionTraceSessionIdSample)
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

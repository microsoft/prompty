// Named sample constants for events/session.tsp.
// Auto-extracted from inline @sample decorators.

namespace Prompty;

const turnCwdSample = #{ cwd: "/workspace/project" };

const turnGitRootSample = #{ gitRoot: "/workspace/project" };

const SessionStartPayloadSessionIdSample = #{ sessionId: "sess_abc123" };

const SessionStartPayloadSchemaVersionSample = #{ schemaVersion: "1" };

const SessionStartPayloadProducerSample = #{ producer: "prompty-agent" };

const SessionStartPayloadRuntimeSample = #{ runtime: "typescript" };

const SessionStartPayloadPromptyVersionSample = #{ promptyVersion: "2.0.0" };

const SessionStartPayloadStartTimeSample = #{
  startTime: "2026-06-09T20:00:00Z",
};

const SessionStartPayloadSelectedModelSample = #{
  selectedModel: "gpt-4o-mini",
};

const SessionStartPayloadReasoningEffortSample = #{ reasoningEffort: "medium" };

const SessionEndPayloadSessionIdSample = #{ sessionId: "sess_abc123" };

const SessionEndPayloadStatusSample = #{ status: "success" };

const SessionEndPayloadReasonSample = #{ reason: "complete" };

const SessionEndPayloadDurationMsSample = #{ durationMs: 12500 };

const SessionWarningPayloadWarningTypeSample = #{ warningType: "remote" };

const SessionWarningPayloadMessageSample = #{
  message: "Remote session disabled",
};

const SessionEventIdSample = #{ id: "evt_abc123" };

const SessionEventTimestampSample = #{ timestamp: "2026-06-09T20:00:00Z" };

const SessionEventSessionIdSample = #{ sessionId: "sess_abc123" };

const SessionEventTurnIdSample = #{ turnId: "turn_001" };

const SessionEventParentIdSample = #{ parentId: "evt_parent" };

const SessionEventSpanIdSample = #{ spanId: "span_hook_001" };

const CheckpointIdSample = #{ id: "chk_abc123" };

const CheckpointSessionIdSample = #{ sessionId: "sess_abc123" };

const CheckpointTurnIdSample = #{ turnId: "turn_001" };

const CheckpointCheckpointNumberSample = #{ checkpointNumber: 3 };

const CheckpointTitleSample = #{ title: "Added harness contracts" };

const CheckpointCreatedAtSample = #{ createdAt: "2026-06-09T20:00:00Z" };

const TrajectoryEventIdSample = #{ id: "traj_abc123" };

const TrajectoryEventSessionIdSample = #{ sessionId: "sess_abc123" };

const TrajectoryEventTurnIdSample = #{ turnId: "turn_001" };

const TrajectoryEventToolCallIdSample = #{ toolCallId: "call_abc123" };

const TrajectoryEventTurnIndexSample = #{ turnIndex: 4 };

const TrajectoryEventEventTypeSample = #{ eventType: "command" };

const TrajectoryEventCreatedAtSample = #{ createdAt: "2026-06-09T20:00:00Z" };

const SessionFileRefSessionIdSample = #{ sessionId: "sess_abc123" };

const SessionFileRefPathSample = #{ path: "src/index.ts" };

const SessionFileRefToolNameSample = #{ toolName: "view" };

const SessionFileRefTurnIndexSample = #{ turnIndex: 2 };

const SessionFileRefFirstSeenAtSample = #{
  firstSeenAt: "2026-06-09T20:00:00Z",
};

const SessionRefSessionIdSample = #{ sessionId: "sess_abc123" };

const SessionRefRefTypeSample = #{ refType: "issue" };

const SessionRefRefValueSample = #{ refValue: "owner/repo#123" };

const SessionRefTurnIndexSample = #{ turnIndex: 2 };

const SessionRefCreatedAtSample = #{ createdAt: "2026-06-09T20:00:00Z" };

const SessionSummarySessionIdSample = #{ sessionId: "sess_abc123" };

const SessionSummaryStatusSample = #{ status: "success" };

const SessionSummaryTurnsSample = #{ turns: 5 };

const SessionSummaryCheckpointsSample = #{ checkpoints: 2 };

const SessionSummaryDurationMsSample = #{ durationMs: 12500 };

const SessionTraceVersionSample = #{ version: "1" };

const SessionTraceRuntimeSample = #{ runtime: "typescript" };

const SessionTracePromptyVersionSample = #{ promptyVersion: "2.0.0" };

const SessionTraceSessionIdSample = #{ sessionId: "sess_abc123" };

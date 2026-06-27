import "@typra/emitter";
import "../events/payloads.tsp";
import "../events/session.tsp";

namespace Prompty;

@@protocol(EventSink);
@@method(EventSink,
  "emitTurn",
  "boolean",
  "Emit a typed turn event to a host sink",
  #{ turnEvent: "TurnEvent" },
  false,
  true
);
@@method(EventSink,
  "emitSession",
  "boolean",
  "Emit a typed session event to a host sink",
  #{ sessionEvent: "SessionEvent" },
  false,
  true
);

/** Receives typed turn and session events from a harness. */
model EventSink {}

@@protocol(EventJournalWriter);
@@method(EventJournalWriter,
  "appendTurn",
  "boolean",
  "Append a turn event to a durable replay journal",
  #{ turnEvent: "TurnEvent" },
  false,
  true
);
@@method(EventJournalWriter,
  "appendSession",
  "boolean",
  "Append a session event to a durable replay journal",
  #{ sessionEvent: "SessionEvent" },
  false,
  true
);
@@method(EventJournalWriter,
  "close",
  "boolean",
  "Finalize the journal with an optional session summary",
  #{ summary: "SessionSummary?" },
  false,
  true
);

/** Persists typed events to a durable replay journal. */
model EventJournalWriter {}

@@protocol(PermissionResolver);
@@method(PermissionResolver,
  "request",
  "PermissionDecision",
  "Resolve a host permission request",
  #{ request: "PermissionRequest" }
);

/** Resolves host permission requests for potentially sensitive actions. */
model PermissionResolver {}

@@protocol(CheckpointStore);
@@method(CheckpointStore,
  "save",
  "Checkpoint",
  "Persist a session checkpoint and return the stored checkpoint",
  #{ checkpoint: "Checkpoint" }
);
@@method(CheckpointStore,
  "load",
  "Checkpoint?",
  "Load a checkpoint by session and checkpoint identifier",
  #{ sessionId: "string", checkpointId: "string" }
);
@@method(CheckpointStore,
  "listCheckpoints",
  "Checkpoint[]",
  "List checkpoints for a session",
  #{ sessionId: "string" }
);

/** Stores and retrieves resumable session checkpoints. */
model CheckpointStore {}

@@protocol(HostToolExecutor);
@@method(HostToolExecutor,
  "execute",
  "HostToolResult",
  "Execute a concrete host tool request and return its completion payload",
  #{ request: "HostToolRequest" }
);

/** Executes host tools after policy and permission checks. */
model HostToolExecutor {}

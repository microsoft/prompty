import "@typra/emitter";
import "./checkpoint.tsp";
import "./engine-events.tsp";
import "./invocation.tsp";
import "./turn-engine.tsp";

namespace Prompty;

@@protocol(EnginePermissionPort);
@@method(EnginePermissionPort,
  "authorize",
  "EnginePermissionDecision",
  "Authorize one model-requested tool before execution",
  #{ request: "ModelToolRequest" },
  false,
  false,
  #{ runtimeCancellable: true }
);

/** Authorizes model-requested tools at a runtime cancellation boundary. */
model EnginePermissionPort {}

@@protocol(EngineToolPort);
@@method(EngineToolPort,
  "execute",
  "ModelToolResult",
  "Execute one authorized model-requested tool",
  #{ request: "ModelToolRequest" },
  false,
  false,
  #{ runtimeCancellable: true }
);

/** Executes authorized model-requested tools at a runtime cancellation boundary. */
model EngineToolPort {}

@@protocol(EngineDurabilityPort);
@@method(EngineDurabilityPort,
  "append",
  "void",
  "Append one semantic engine event durably",
  #{ event: "EngineEvent" },
  false,
  false
);
@@method(EngineDurabilityPort,
  "appendWithCheckpoint",
  "void",
  "Atomically append semantic engine events and persist the checkpoint that reflects them",
  #{ events: "EngineEvent[]", checkpoint: "EngineCheckpoint" },
  false,
  false,
  #{ atomic: true }
);

/** Persists semantic engine events and checkpoints without runtime cancellation. */
model EngineDurabilityPort {}

@@protocol(EnginePostCommitPort);
@@method(EnginePostCommitPort,
  "afterCommit",
  "void",
  "Run one idempotent host effect after the turn is durably committed",
  #{ effectId: "string", commit: "TurnCommit" },
  false,
  false,
  #{ runtimeCancellable: true, nonFatal: true }
);

/** Runs non-fatal host effects after a turn is durably committed. */
model EnginePostCommitPort {}

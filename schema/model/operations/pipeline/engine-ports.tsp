import "@typra/emitter";
import "../../contracts/pipeline/checkpoint.tsp";
import "../../contracts/pipeline/engine-events.tsp";
import "../../contracts/pipeline/invocation.tsp";
import "../../contracts/pipeline/turn-engine.tsp";

using Prompty.Contracts.Pipeline;
namespace Prompty.Operations.Pipeline;

/** Authorizes model-requested tools at a runtime cancellation boundary. */
interface EnginePermissionPort {
  @doc("Authorize one model-requested tool before execution")
  @runtimeCancellable
  authorize(request: ModelToolRequest): EnginePermissionDecision;
}

/** Executes authorized model-requested tools at a runtime cancellation boundary. */
interface EngineToolPort {
  @doc("Execute one authorized model-requested tool")
  @runtimeCancellable
  execute(request: ModelToolRequest): ModelToolResult;
}

/** Persists semantic engine events and checkpoints without runtime cancellation. */
interface EngineDurabilityPort {
  @doc("Append one semantic engine event durably")
  append(event: EngineEvent): void;

  @doc("Atomically append semantic engine events and persist the checkpoint that reflects them")
  @effect(#{ atomic: true })
  appendWithCheckpoint(events: EngineEvent[], checkpoint: EngineCheckpoint): void;
}

/** Runs non-fatal host effects after a turn is durably committed. */
interface EnginePostCommitPort {
  @doc("Run one idempotent host effect after the turn is durably committed")
  @runtimeCancellable
  @effect(#{ nonFatal: true })
  afterCommit(effectId: string, commit: TurnCommit): void;
}

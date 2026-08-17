import "@typra/emitter";
import "../../contracts/events/payloads.tsp";
import "../../contracts/events/session.tsp";

using Prompty.Contracts.Events;
namespace Prompty.Operations.Pipeline;

/** Receives typed turn and session events from a harness. */
interface EventSink {
  @doc("Emit a typed turn event to a host sink")
  @sync
  @effect(#{ nonFatal: true })
  emitTurn(turnEvent: TurnEvent): boolean;

  @doc("Emit a typed session event to a host sink")
  @sync
  @effect(#{ nonFatal: true })
  emitSession(sessionEvent: SessionEvent): boolean;
}

/** Persists typed events to a durable replay journal. */
interface EventJournalWriter {
  @doc("Append a turn event to a durable replay journal")
  @sync
  @effect(#{ atomic: true })
  appendTurn(turnEvent: TurnEvent): boolean;

  @doc("Append a session event to a durable replay journal")
  @sync
  @effect(#{ atomic: true })
  appendSession(sessionEvent: SessionEvent): boolean;

  @doc("Finalize the journal with an optional session summary")
  @sync
  @effect(#{ atomic: true })
  close(summary?: SessionSummary): boolean;
}

/** Resolves host permission requests for potentially sensitive actions. */
interface PermissionResolver {
  @doc("Resolve a host permission request")
  request(request: PermissionRequest): PermissionDecision;
}

/** Stores and retrieves resumable session checkpoints. */
interface CheckpointStore {
  @doc("Persist a session checkpoint and return the stored checkpoint")
  @effect(#{ atomic: true })
  save(checkpoint: Checkpoint): Checkpoint;

  @doc("Load a checkpoint by session and checkpoint identifier")
  load(sessionId: string, checkpointId: string): Checkpoint | null;

  @doc("List checkpoints for a session")
  listCheckpoints(sessionId: string): Checkpoint[];
}

/** Executes host tools after policy and permission checks. */
interface HostToolExecutor {
  @doc("Execute a concrete host tool request and return its completion payload")
  execute(request: HostToolRequest): HostToolResult;
}

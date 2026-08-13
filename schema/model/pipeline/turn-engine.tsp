import "@typra/emitter";
import "../conversation/message.tsp";
import "./engine-events.tsp";
import "./invocation.tsp";

namespace Prompty;

/** Terminal status of a live-engine turn. */
alias EngineTurnStatus =
  | "success"
  | "failed"
  | "cancelled"
  | "reconciliation_required";

/** The committed outcome of a turn handed to post-commit consumers. */
model TurnCommit {
  @doc("Stable session identifier")
  @sample(TurnCommitSessionIdSample)
  sessionId: string;

  @doc("Stable turn identifier")
  @sample(TurnCommitTurnIdSample)
  turnId: string;

  @doc("Terminal status of the turn")
  status: EngineTurnStatus;

  @doc("Final output when the turn succeeded")
  output?: unknown;

  @doc("Canonical conversation messages at commit time")
  messages: Message[];

  @doc("Number of model loop iterations executed")
  iterations: int32;

  @doc("Last committed event sequence for the turn")
  lastSequence: int64;

  @doc("Provider-context state carried out of the turn")
  contextState: InvocationContextState;

  @doc("Typed provider state when the commit requires model reconciliation")
  modelReconciliation?: ModelReconciliationState;
}

/** The result returned by the live turn engine. */
model TurnEngineResult {
  @doc("The committed turn outcome")
  commit: TurnCommit;

  @doc("Immutable context snapshots produced during the turn")
  snapshots?: ModelInvocationContextSnapshot[];

  @doc("Normalized tool results produced during the turn")
  toolResults?: ModelToolResult[];

  @doc("A non-fatal post-commit failure; the turn itself remains committed")
  postCommitError?: string;
}

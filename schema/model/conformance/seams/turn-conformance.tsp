import "@typra/emitter";

using Prompty.Conformance.Vectors;
namespace Prompty.Conformance.Seams;

/**
 * Conformance-only seam that hosts the turn-engine behavior vectors: the agent
 * tool-calling loop against a scripted model, the turn engine's ordered typed
 * event stream, and the normalized replay journal. Each is validated
 * identically across every runtime.
 *
 * This interface exists purely to carry @vector evidence into the emitted
 * cross-runtime vectors.json; no runtime is expected to implement it. It is
 * intentionally distinct from the runtime turn-runner reference implementations
 * so it never collides with hand-written turn/replay contracts.
 */
interface TurnConformance {
  @doc("Run the agent tool-calling loop against a scripted model to a final result")
  @vector(AgentVectors)
  run(input: unknown): unknown;

  @doc("Run a single turn and assert the ordered typed event stream it emits")
  @vector(TurnVectors)
  runTurn(input: unknown): unknown;

  @doc("Run a scenario and assert the normalized replay journal sequence")
  @vector(ReplayVectors)
  replay(input: unknown): unknown;
}

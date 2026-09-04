import "@typra/emitter";

using Prompty.Conformance.Vectors;
namespace Prompty.Conformance.Seams;

/**
 * Conformance-only seam hosting the "service drill" vectors: a conformance
 * vector that crosses the REAL Executor->Processor transport seam instead of
 * stopping at the SDK edge. A drill runs against a live provider when
 * credentials are present and REPLAYS a recorded cassette when they are not;
 * the live<->replay parity is the gate.
 *
 * Like every other conformance seam this interface exists purely to carry
 * @vector evidence into the emitted cross-runtime vectors.json; no runtime
 * implements it directly. The consumer-owned drill adapter (roster) reads the
 * vector's `exchange` block -- an UNKNOWN key that rides through the emitter
 * untouched -- to bind the transport and assert the transport/wire/semantic
 * planes. Nothing in Typra needs to know the word "drill".
 */
interface LiveChatConformance {
  @doc("Drive a real chat completion across the transport seam (live or cassette-replay) and assert 3 planes")
  @vector(DrillVectors)
  complete(input: unknown): unknown;
}

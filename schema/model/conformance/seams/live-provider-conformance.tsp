import "@typra/emitter";

using Prompty.Conformance.Vectors;
namespace Prompty.Conformance.Seams;

/**
 * Conformance-only seam for opt-in live provider acceptance probes.
 *
 * Deterministic wire vectors own the canonical request bodies. These vectors
 * run only when their declared provider credentials/capabilities are present
 * and assert that the real provider accepts the runtime's request today.
 */
interface LiveProviderConformance {
  @doc("Invoke a live provider and return structural acceptance evidence")
  @vector(LiveProviderVectors)
  invoke(input: unknown): unknown;
}

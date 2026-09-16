import "@typra/emitter";

using Prompty.Conformance.Vectors;
namespace Prompty.Conformance.Seams;

/**
 * Conformance-only seam that hosts deterministic memory behavior vectors:
 * recall ranking, mutation policy, formatting, host snapshot persistence, and
 * memory lifecycle behavior that makes core memories visible to the model.
 *
 * This exists only to carry vector evidence into vectors.json. Runtime storage
 * backends, embeddings, indexes, and eviction implementation strategy remain
 * runtime-owned as long as the observable behavior matches these vectors. Hosts
 * own persistence by loading and saving whole-store snapshots; runtimes own
 * deterministic operations over MemoryStore snapshots.
 */
interface MemoryConformance {
  @doc("Run a deterministic memory operation against a MemoryStore snapshot")
  @vector(MemoryVectors)
  operate(input: unknown): unknown;
}

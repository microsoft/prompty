import "@typra/emitter";
import "../../agent.tsp";

using Prompty;
using Prompty.Conformance.Vectors;
namespace Prompty.Conformance.Seams;

/**
 * Conformance-only seam that hosts the loader behavior vectors. Loading a
 * .prompty document (frontmatter + body, with env/file reference resolution)
 * into a canonical Agent is validated identically across every runtime.
 *
 * This interface exists purely to carry @vector evidence into the emitted
 * cross-runtime vectors.json; no runtime is expected to implement it.
 */
interface LoadConformance {
  @doc("Load a .prompty document into an Agent, resolving env/file references")
  @vector(LoadVectors)
  load(source: unknown): Agent;
}

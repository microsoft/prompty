import "@typra/emitter";
import "../../contracts/models/discovery.tsp";

using Prompty.Conformance.Vectors;
using Prompty.Contracts.Models;
namespace Prompty.Conformance.Seams;

/**
 * Conformance-only seam that hosts the model-discovery behavior vectors:
 * mapping raw provider discovery payloads into canonical ModelInfo, and
 * enriching sparse results from the shared model-capability dataset. Both
 * algorithms are validated independently and identically across runtimes.
 *
 * This interface exists purely to carry @vector evidence into the emitted
 * cross-runtime vectors.json; no runtime is expected to implement it.
 */
interface DiscoveryConformance {
  @doc("Map a raw provider model/deployment/catalog payload to canonical ModelInfo")
  @vector(DiscoveryVectors)
  mapModel(raw: unknown): ModelInfo;

  @doc("Fill only-missing ModelInfo fields from the shared capability dataset")
  @vector(EnrichmentVectors)
  enrich(base: ModelInfo): ModelInfo;
}

import "@typra/emitter";
import "../../agent.tsp";
import "../../contracts/conversation/message.tsp";

using Prompty;
using Prompty.Conformance.Vectors;
using Prompty.Contracts.Conversation;
namespace Prompty.Conformance.Seams;

/**
 * Conformance-only seam that hosts the provider wire-mapping behavior vectors.
 * Mapping canonical agent + messages into a provider-specific request body is
 * validated identically across every runtime.
 *
 * This interface exists purely to carry @vector evidence into the emitted
 * cross-runtime vectors.json; no runtime is expected to implement it.
 */
interface WireConformance {
  @doc("Build the provider-specific wire request body from canonical inputs")
  @vector(WireVectors)
  toRequest(agent: Agent, messages: Message[]): unknown;
}

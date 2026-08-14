import "@typra/emitter";
import "../../agent.tsp";

using Prompty;
using Prompty.Conformance.Vectors;
namespace Prompty.Operations.Pipeline;

/** Renders a template string with input values to produce the final prompt text. */
interface Renderer {
  @doc("Render the template string with input values")
  @vector(RenderVectors)
  render(agent: Agent, template: string, inputs: Record<unknown>): string;
}

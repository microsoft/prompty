import "@typra/emitter";
import "../agent/agent.tsp";

namespace Prompty;

/** Renders a template string with input values to produce the final prompt text. */
interface Renderer {
  @doc("Render the template string with input values")
  @vector(RenderVectors)
  render(agent: Prompty, template: string, inputs: Record<unknown>): string;
}

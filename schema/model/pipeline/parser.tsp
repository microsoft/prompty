import "@typra/emitter";
import "../agent/agent.tsp";
import "../conversation/message.tsp";

namespace Prompty;

/** Parses rendered prompt text into an array of structured messages with role markers. */
interface Parser {
  @doc("Pre-process a template before rendering, returning modified template and context")
  @optionalOperation
  @sync
  preRender(template: string): unknown | null;

  @doc("Parse rendered text into a structured message array")
  @vector(ParseVectors)
  parse(agent: Prompty, rendered: string, context?: Record<unknown>): Message[];
}

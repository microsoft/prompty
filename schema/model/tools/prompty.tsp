import "../core.tsp";
import "../tools.tsp";

namespace Prompty;

/**
 * A tool that references another .prompty file to be invoked as a tool.
 *
 * PromptyTool is always single-shot — the child prompty is loaded, rendered,
 * and executed with a single LLM call (invoke). It does NOT run an agent loop.
 *
 * Applications that need agentic sub-agent delegation should register
 * `kind: function` tools that internally call `turn()` with their own TurnOptions.
 */
model PromptyTool extends Tool {
  @doc("The kind identifier for prompty tools")
  @sample(#{ kind: "prompty" })
  kind: "prompty";

  @doc("Path to the child .prompty file, relative to the parent")
  @sample(#{ path: "./summarize.prompty" })
  path: string;
}

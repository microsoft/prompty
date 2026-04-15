import "../core.tsp";
import "../tools.tsp";

namespace Prompty;

alias promptyToolMode = "single" | "agentic";

/**
 * A tool that references another .prompty file to be invoked as a tool.
 *
 * In `single` mode, the child prompty is executed with a single LLM call.
 * In `agentic` mode, the child prompty runs a full agent loop with its own tools.
 */
model PromptyTool extends Tool {
  @doc("The kind identifier for prompty tools")
  @sample(#{ kind: "prompty" })
  kind: "prompty";

  @doc("Path to the child .prompty file, relative to the parent")
  @sample(#{ path: "./summarize.prompty" })
  path: string;

  @doc("Execution mode: 'single' for one LLM call, 'agentic' for full agent loop")
  @sample(#{ mode: "single" })
  mode: promptyToolMode = "single";
}

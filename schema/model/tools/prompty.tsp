import "../core.tsp";
import "../tools.tsp";

namespace Prompty;

/**
 * A tool that references another .prompty file to be invoked as a tool.
 *
 * The child prompty is loaded, rendered, and executed with a single LLM call
 * (invoke). Apps that want agentic sub-agents should use `kind: function` tools
 * and call `turn()` themselves.
 */
model PromptyTool extends Tool {
  @doc("The kind identifier for prompty tools")
  @sample(#{ kind: "prompty" })
  kind: "prompty";

  @doc("Path to the child .prompty file, relative to the parent")
  @sample(#{ path: "./summarize.prompty" })
  path: string;
}

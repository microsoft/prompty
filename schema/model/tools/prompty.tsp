import "../core.tsp";
import "../tools.tsp";

namespace Prompty;

/**
 * Execution mode for a PromptyTool.
 *
 * - `single`: The child prompty is loaded, rendered, and executed with a single
 *   LLM call (invoke). No agent loop.
 * - `agentic`: The child prompty runs as a sub-agent via `turn()`, with its own
 *   tool-calling loop, streaming, and cancellation support.
 */
alias PromptyToolMode = "single" | "agentic";

/**
 * A tool that references another .prompty file to be invoked as a tool.
 *
 * In `single` mode (default), the child prompty is loaded, rendered, and
 * executed with a single LLM call (invoke). In `agentic` mode, the child
 * runs as a sub-agent via `turn()` with its own tool-calling loop.
 */
model PromptyTool extends Tool {
  @doc("The kind identifier for prompty tools")
  @sample(#{ kind: "prompty" })
  kind: "prompty";

  @doc("Path to the child .prompty file, relative to the parent")
  @sample(#{ path: "./summarize.prompty" })
  path: string;

  @doc("Execution mode — 'single' for single-shot invoke (default) or 'agentic' for sub-agent turn")
  @sample(#{ mode: "single" })
  mode?: PromptyToolMode = "single";
}

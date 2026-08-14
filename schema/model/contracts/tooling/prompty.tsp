import "../core/core.tsp";
import "./tool.tsp";

using Prompty.Conformance.Samples;
namespace Prompty.Contracts.Tooling;

alias promptyToolMode = "single";

/**
 * A tool that references another .prompty file to be invoked as a tool.
 *
 * The child prompty is executed as a single prompt invocation. Nested agent
 * loops are intentionally not started from PromptyTool.
 */
model PromptyTool extends Tool {
  @doc("The kind identifier for prompty tools")
  @sample(PromptyToolKindSample)
  kind: "prompty";

  @doc("Path to the child .prompty file, relative to the parent")
  @sample(PromptyToolPathSample)
  path: string;

  @doc("Execution mode. Only 'single' is supported; nested agent loops are not started from PromptyTool.")
  @sample(PromptyToolModeSample)
  mode: promptyToolMode = "single";
}

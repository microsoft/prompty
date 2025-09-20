import "../core.tsp";
import "../tools.tsp";
import "../connection.tsp";
import "../model.tsp";

namespace Prompty.Core {
  /**
   * The MCP Server tool.
   */
  model ModelTool extends Tool {
    @doc("The kind identifier for a model connection as a tool")
    @sample(#{ kind: "model" })
    kind: "model";

    @doc("The connection configuration for the model tool")
    `model`: Model;
  }
}

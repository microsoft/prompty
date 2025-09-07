import "../core.tsp";
import "../tools.tsp";
import "../connection.tsp";

namespace Prompty.Core {
  /**
   * Configuration options for the MCP tool.
   */
  model McpToolOptions {
    @doc("The name of the MCP tool")
    name: string;

    @doc("The URL of the MCP server")
    url: string;

    @doc("List of allowed operations or resources for the MCP tool")
    allowed: string[] = #[];

  }

  /**
   * The MCP Server tool.
   */
  model McpTool extends Tool {
    @doc("The kind identifier for MCP tools")
    kind: "mcp";

    @doc("The connection configuration for the MCP tool")
    connection: Connection;

    @doc("The options for the MCP tool")
    options: McpToolOptions;
  }
}

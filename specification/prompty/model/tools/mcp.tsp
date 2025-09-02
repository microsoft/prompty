import "../core.tsp";
import "../tools.tsp";
import "./authentication.tsp";

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

    @doc("Authentication configuration for the MCP tool")
    authentication: Authentication;
  }

  /**
   * The MCP Server tool.
   */
  model McpTool extends Tool {
    @doc("The type identifier for MCP tools")
    type: "mcp";

    @doc("The options for the MCP tool")
    options: McpToolOptions;
  }
}

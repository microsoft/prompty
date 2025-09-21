import "../core.tsp";
import "../tools.tsp";
import "../connection.tsp";

namespace Prompty.Core {
  /**
   * The MCP Server tool.
   */
  model McpTool extends Tool {
    @doc("The kind identifier for MCP tools")
    @sample(#{ kind: "mcp" })
    kind: "mcp";

    @doc("The connection configuration for the MCP tool")
    @sample(#{
      connection: #{ kind: "provider-connection" },
    })
    connection: Connection;

    @doc("The name of the MCP tool")
    @sample(#{ name: "My MCP Tool" })
    name: string;

    @doc("The URL of the MCP server")
    @sample(#{ url: "https://mcp.server.com" })
    url: string;

    @doc("List of allowed operations or resources for the MCP tool")
    @sample(#{ allowed: #["operation1", "operation2"] })
    allowed: string[] = #[];
  }
}

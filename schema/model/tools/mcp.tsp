import "../core.tsp";
import "../tools.tsp";
import "../connection.tsp";

namespace Prompty;

/**
 * The MCP Server tool.
 */
model McpTool extends Tool {
  @doc("The kind identifier for MCP tools")
  @sample(#{ kind: "mcp" })
  kind: "mcp";

  @doc("The connection configuration for the MCP tool")
  @sample(#{ connection: #{ kind: "reference" } })
  connection: Connection;

  @doc("The server name of the MCP tool")
  @sample(#{ serverName: "My MCP Server" })
  serverName: string;

  @doc("The description of the MCP tool")
  @sample(#{ serverDescription: "This tool allows access to MCP services." })
  serverDescription?: string;

  @doc("The approval mode for the MCP tool")
  @sample(#{ approvalMode: #{ kind: "always" } })
  approvalMode: McpApprovalMode;

  @doc("List of allowed operations or resources for the MCP tool")
  @sample(#{ allowedTools: #["operation1", "operation2"] })
  allowedTools?: string[];
}

alias mcpApprovalModeKind = "always" | "never" | "specify";

/**
 * The approval mode for MCP server tools.
 * When kind is "specify", use alwaysRequireApprovalTools and neverRequireApprovalTools
 * to control per-tool approval. For "always" and "never", those fields are ignored.
 */
@shorthand(string, #{ kind: "{value}" }, "kind", "Mcp Approval Mode", "never")
model McpApprovalMode {
  @doc("The approval mode: 'always', 'never', or 'specify'")
  @sample(#{ kind: "never" })
  kind: mcpApprovalModeKind;

  @doc("List of tools that always require approval (only used when kind is 'specify')")
  @sample(#{ alwaysRequireApprovalTools: #["operation1"] })
  alwaysRequireApprovalTools?: string[];

  @doc("List of tools that never require approval (only used when kind is 'specify')")
  @sample(#{ neverRequireApprovalTools: #["operation2"] })
  neverRequireApprovalTools?: string[];
}

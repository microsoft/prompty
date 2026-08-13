import "../core/core.tsp";
import "./tool.tsp";
import "../connection/connection.tsp";

namespace Prompty;

/**
 * The MCP Server tool.
 */
model McpTool extends Tool {
  @doc("The kind identifier for MCP tools")
  @sample(McpToolKindSample)
  kind: "mcp";

  @doc("The connection configuration for the MCP tool")
  @sample(McpToolConnectionSample)
  connection: Connection;

  @doc("The server name of the MCP tool")
  @sample(McpToolServerNameSample)
  serverName: string;

  @doc("The description of the MCP tool")
  @sample(McpToolServerDescriptionSample)
  serverDescription?: string;

  @doc("The approval mode for the MCP tool")
  @sample(McpToolApprovalModeSample)
  approvalMode?: McpApprovalMode;

  @doc("List of allowed operations or resources for the MCP tool")
  @sample(McpToolAllowedToolsSample)
  allowedTools?: string[];
}

alias mcpApprovalModeKind = "always" | "never" | "specify";

/**
 * The approval mode for MCP server tools.
 * When kind is "specify", use alwaysRequireApprovalTools and neverRequireApprovalTools
 * to control per-tool approval. For "always" and "never", those fields are ignored.
 */
@coerce(string, #{ kind: "{value}" }, "kind", "Mcp Approval Mode", "never")
model McpApprovalMode {
  @doc("The approval mode: 'always', 'never', or 'specify'")
  @sample(McpApprovalModeKindSample)
  kind: mcpApprovalModeKind;

  @doc("List of tools that always require approval (only used when kind is 'specify')")
  @sample(McpApprovalModeAlwaysRequireApprovalToolsSample)
  alwaysRequireApprovalTools?: string[];

  @doc("List of tools that never require approval (only used when kind is 'specify')")
  @sample(McpApprovalModeNeverRequireApprovalToolsSample)
  neverRequireApprovalTools?: string[];
}

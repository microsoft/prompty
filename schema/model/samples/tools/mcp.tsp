// Named sample constants for tools/mcp.tsp.
// Auto-extracted from inline @sample decorators.

using Prompty.Contracts.Core;
namespace Prompty.Conformance.Samples;

const McpToolKindSample = #{ kind: "mcp" };

const McpToolConnectionSample = #{ connection: #{ kind: "reference" } };

const McpToolServerNameSample = #{ serverName: "My MCP Server" };

const McpToolServerDescriptionSample = #{
  serverDescription: "This tool allows access to MCP services.",
};

const McpToolApprovalModeSample = #{ approvalMode: #{ kind: "always" } };

const McpToolAllowedToolsSample = #{
  allowedTools: #["operation1", "operation2"],
};

const McpApprovalModeKindSample = #{ kind: "never" };

const McpApprovalModeAlwaysRequireApprovalToolsSample = #{
  alwaysRequireApprovalTools: #["operation1"],
};

const McpApprovalModeNeverRequireApprovalToolsSample = #{
  neverRequireApprovalTools: #["operation2"],
};

---
title: "McpTool"
description: "Documentation for the McpTool type."
slug: "reference/mcptool"
---

The MCP Server tool.

## Class Diagram

```mermaid
---
title: McpTool
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Tool {
        +string name
        +string kind
        +string description
        +Binding[] bindings
    }
    Tool <|-- McpTool
    class McpTool {
      
        +string kind
        +Connection connection
        +string serverName
        +string serverDescription
        +McpApprovalMode approvalMode
        +string[] allowedTools
    }
    class McpApprovalMode {
        +string kind
        +string[] alwaysRequireApprovalTools
        +string[] neverRequireApprovalTools
    }
    McpTool *-- McpApprovalMode
```

## Yaml Example

```yaml
kind: mcp
connection:
  kind: reference
serverName: My MCP Server
serverDescription: This tool allows access to MCP services.
approvalMode:
  kind: always
allowedTools:
  - operation1
  - operation2
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for MCP tools |
| connection | [Connection](../connection/) | The connection configuration for the MCP tool |
| serverName | string | The server name of the MCP tool |
| serverDescription | string | The description of the MCP tool |
| approvalMode | [McpApprovalMode](../mcpapprovalmode/) | The approval mode for the MCP tool |
| allowedTools | string[] | List of allowed operations or resources for the MCP tool |

## Composed Types

The following types are composed within `McpTool`:

- [McpApprovalMode](../mcpapprovalmode/)

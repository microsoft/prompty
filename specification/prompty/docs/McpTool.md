# McpTool

The MCP Server tool.

## Class Diagram

```mermaid
---
title: McpTool
---
classDiagram
    class McpTool {
        +string kind
        +Connection connection
        +McpToolOptions options
    }
```






## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for MCP tools  |
| connection | [Connection](Connection.md) | The connection configuration for the MCP tool  |
| options | [McpToolOptions](McpToolOptions.md) | The options for the MCP tool  |




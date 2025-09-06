# McpTool

The MCP Server tool.

## Class Diagram

```mermaid
---
title: McpTool
---
classDiagram
    class McpTool {
        +string type
        +Connection connection
        +McpToolOptions options
    }
```






## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | string | The type identifier for MCP tools  |
| connection | [Connection](Connection.md) | The connection configuration for the MCP tool  |
| options | [McpToolOptions](McpToolOptions.md) | The options for the MCP tool  |




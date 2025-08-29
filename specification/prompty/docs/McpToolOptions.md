# McpToolOptions

Configuration options for the MCP tool.

## Class Diagram

```mermaid
---
title: McpToolOptions
---
classDiagram
    class Options {
    }
    class Authentication {
        +string type
        +Options credentials
    }
    class McpToolOptions {
        +string name
        +string url
        +string[] allowed
        +Authentication authentication
    }
    McpToolOptions *-- Authentication
```





## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name | string | The name of the MCP tool  |
| url | string | The URL of the MCP server  |
| allowed | string Collection | List of allowed operations or resources for the MCP tool  |
| authentication | [Authentication](Authentication.md) | Authentication configuration for the MCP tool  |



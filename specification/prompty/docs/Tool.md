# Tool

Represents a tool that can be used in prompts.

## Class Diagram

```mermaid
---
title: Tool
---
classDiagram
    class Tool {
        +string name
        +string kind
        +string description
        +Binding[] bindings
    }
    class FunctionTool {
        +string kind
        +Parameter[] parameters
    }
    Tool <|-- FunctionTool
    class ServerTool {
        +string kind
        +Connection connection
        +dictionary options
    }
    Tool <|-- ServerTool
    class BingSearchTool {
        +string kind
        +Connection connection
        +BingSearchOptions options
    }
    Tool <|-- BingSearchTool
    class FileSearchTool {
        +string kind
        +Connection connection
        +FileSearchOptions options
    }
    Tool <|-- FileSearchTool
    class McpTool {
        +string kind
        +Connection connection
        +McpToolOptions options
    }
    Tool <|-- McpTool
```



## Yaml Example
```yaml
kind: function
description: A description of the tool
bindings:
  input: value

```




## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name | string | Name of the item  |
| kind | string | The kind identifier for the tool  |
| description | string | A short description of the tool for metadata purposes  |
| bindings | [Binding Collection](Binding.md) | Tool argument bindings to input properties  |



## Child Types

The following types extend `Tool`:
- [FunctionTool](FunctionTool.md)
- [ServerTool](ServerTool.md)
- [BingSearchTool](BingSearchTool.md)
- [FileSearchTool](FileSearchTool.md)
- [McpTool](McpTool.md)


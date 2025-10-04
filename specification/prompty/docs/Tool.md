# Tool

Represents a tool that can be used in prompts.

## Class Diagram

```mermaid
---
title: Tool
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Tool {
      <<abstract>>
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
        +BingSearchConfiguration[] configurations
    }
    Tool <|-- BingSearchTool
    class FileSearchTool {
        +string kind
        +Connection connection
        +int32 maxNumResults
        +string ranker
        +float32 scoreThreshold
        +string[] vectorStoreIds
    }
    Tool <|-- FileSearchTool
    class McpTool {
        +string kind
        +Connection connection
        +string name
        +string url
        +string[] allowed
    }
    Tool <|-- McpTool
    class ModelTool {
        +string kind
        +Model model
    }
    Tool <|-- ModelTool
    class OpenApiTool {
        +string kind
        +Connection connection
        +string specification
    }
    Tool <|-- OpenApiTool
    class CodeInterpreterTool {
        +string kind
        +string[] fileIds
    }
    Tool <|-- CodeInterpreterTool
    class Binding {
        +string name
        +string input
    }
    Tool *-- Binding
```

## Yaml Example

```yaml
name: my-tool
kind: function
description: A description of the tool
bindings:
  input: value

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name | string | Name of the tool. If a function tool, this is the function name, otherwise it is the type  |
| kind | string | The kind identifier for the tool  |
| description | string | A short description of the tool for metadata purposes  |
| bindings | [Binding[]](Binding.md) | Tool argument bindings to input properties  |

## Child Types

The following types extend `Tool`:

- [FunctionTool](FunctionTool.md)
- [ServerTool](ServerTool.md)
- [BingSearchTool](BingSearchTool.md)
- [FileSearchTool](FileSearchTool.md)
- [McpTool](McpTool.md)
- [ModelTool](ModelTool.md)
- [OpenApiTool](OpenApiTool.md)
- [CodeInterpreterTool](CodeInterpreterTool.md)

## Composed Types

The following types are composed within `Tool`:

- [Binding](Binding.md)

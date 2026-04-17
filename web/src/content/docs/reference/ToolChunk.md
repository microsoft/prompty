---
title: "ToolChunk"
description: "Documentation for the ToolChunk type."
slug: "reference/toolchunk"
---

A tool call chunk from the LLM response stream.

## Class Diagram

```mermaid
---
title: ToolChunk
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class StreamChunk {
        +string kind
    }
    StreamChunk <|-- ToolChunk
    class ToolChunk {
        +string kind
        +ToolCall toolCall
    }
    class ToolCall {
        +string id
        +string name
        +string arguments
    }
    ToolChunk *-- ToolCall
```

## Yaml Example

```yaml
toolCall:
  id: call_abc123
  name: get_weather
  arguments: '{"city": "Paris"}'
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for tool chunks |
| toolCall | [ToolCall](../toolcall/) | The tool call data |

## Composed Types

The following types are composed within `ToolChunk`:

- [ToolCall](../toolcall/)

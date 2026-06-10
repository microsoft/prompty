---
title: "ToolResultPayload"
description: "Documentation for the ToolResultPayload type."
slug: "reference/toolresultpayload"
---

Payload for "tool_result" events — a tool has returned its result.

## Class Diagram

```mermaid
---
title: ToolResultPayload
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class ToolResultPayload {
        +string name
        +ToolResult result
    }
    class ToolResult {
        +ContentPart[] parts
        +string status
        +string errorKind
        +string errorMessage
        +float64 durationMs
        +text() string [async-capable]
    }
    ToolResultPayload *-- ToolResult
```

## Yaml Example

```yaml
name: get_weather
result:
  parts:
    - kind: text
      value: 72°F and sunny
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name | string | The name of the tool that produced the result |
| result | [ToolResult](../toolresult/) | The tool's result |

## Composed Types

The following types are composed within `ToolResultPayload`:

- [ToolResult](../toolresult/)

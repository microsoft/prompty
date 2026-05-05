---
title: "ToolResult"
description: "Documentation for the ToolResult type."
slug: "reference/toolresult"
---

The result of a tool execution. Contains a list of content parts, enabling
rich tool results (text, images, files, audio) rather than just strings.

Implementations MUST support conversion from a plain string to a ToolResult
containing a single TextPart for backward compatibility.

## Class Diagram

```mermaid
---
title: ToolResult
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class ToolResult {
        +ContentPart[] parts
        +text() string [async-capable]
    }
    class ContentPart {
      <<abstract>>
        +string kind
    }
    ToolResult *-- ContentPart
```

## Yaml Example

```yaml
parts:
  - kind: text
    value: 72°F and sunny
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| parts | [ContentPart[]](../contentpart/) | The content parts of the tool result(Related Types: [TextPart](../textpart/), [ImagePart](../imagepart/), [FilePart](../filepart/), [AudioPart](../audiopart/)) |

## Helper Methods

The following helper methods are declared via `@method` and must be implemented by every runtime. The schema declares the logical protocol contract; each runtime maps async-capable methods to idiomatic sync/async shapes for that language.

| Name | Signature | Runtime shape | Description |
| ---- | --------- | ------------- | ----------- |
| `text` | `text() -> string` | async-capable | Concatenate all TextPart values joined by newline |

## Factory Methods

The following factory methods are declared via `@factory` and are generated automatically by the emitter in every language.

- `text(value: string)`

## Composed Types

The following types are composed within `ToolResult`:

- [ContentPart](../contentpart/)

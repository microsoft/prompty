---
title: "ErrorChunk"
description: "Documentation for the ErrorChunk type."
slug: "reference/errorchunk"
---

An error chunk from the LLM response stream.

## Class Diagram

```mermaid
---
title: ErrorChunk
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class StreamChunk {
      <<abstract>>
        +string kind
    }
    StreamChunk <|-- ErrorChunk
    class ErrorChunk {
        +string kind
        +string message
    }
```

## Yaml Example

```yaml
message: Rate limit exceeded
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for error chunks |
| message | string | The error message |

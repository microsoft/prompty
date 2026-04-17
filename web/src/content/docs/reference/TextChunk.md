---
title: "TextChunk"
description: "Documentation for the TextChunk type."
slug: "reference/textchunk"
---

A text content chunk from the LLM response stream.

## Class Diagram

```mermaid
---
title: TextChunk
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
    StreamChunk <|-- TextChunk
    class TextChunk {
        +string kind
        +string value
    }
```

## Yaml Example

```yaml
value: Hello
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for text chunks |
| value | string | The text content of the chunk |

---
title: "TextPart"
description: "Documentation for the TextPart type."
slug: "reference/textpart"
---

A text content part.

## Class Diagram

```mermaid
---
title: TextPart
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class ContentPart {
      <<abstract>>
        +string kind
    }
    ContentPart <|-- TextPart
    class TextPart {
        +string kind
        +string value
    }
```

## Yaml Example

```yaml
value: Hello, world!
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for text content |
| value | string | The text content |

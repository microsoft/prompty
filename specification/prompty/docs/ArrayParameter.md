# ArrayParameter

Represents an array parameter for a tool.

## Class Diagram

```mermaid
---
title: ArrayParameter
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Parameter {
        +string name
        +string kind
        +string description
        +boolean required
        +unknown default
        +unknown value
        +unknown[] enum
    }
    Parameter <|-- ArrayParameter
    class ArrayParameter {
      
        +string kind
        +Parameter items
    }
    class Parameter {
        +string kind
        +string description
        +boolean required
        +unknown default
        +unknown value
        +unknown[] enum
    }
    ArrayParameter *-- Parameter
```

## Yaml Example

```yaml
items:
  kind: string

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string |   |
| items | [Parameter](Parameter.md) | The kind of items contained in the array  |

## Composed Types

The following types are composed within `ArrayParameter`:

- [Parameter](Parameter.md)

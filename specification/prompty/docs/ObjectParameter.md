# ObjectParameter

Represents an object parameter for a tool.

## Class Diagram

```mermaid
---
title: ObjectParameter
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
    Parameter <|-- ObjectParameter
    class ObjectParameter {
      
        +string kind
        +Parameter[] properties
    }
    class Parameter {
        +string name
        +string kind
        +string description
        +boolean required
        +unknown default
        +unknown value
        +unknown[] enum
    }
    ObjectParameter *-- Parameter
```

## Yaml Example

```yaml
properties:
  param1:
    kind: string
  param2:
    kind: number

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string |   |
| properties | [Parameter[]](Parameter.md) | The properties of the object parameter (Related Types: [ArrayParameter](ArrayParameter.md)) |

## Composed Types

The following types are composed within `ObjectParameter`:

- [Parameter](Parameter.md)

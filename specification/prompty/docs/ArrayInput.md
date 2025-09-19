# ArrayInput

Represents an array output property.
This extends the base Output model to represent an array of items.

## Class Diagram

```mermaid
---
title: ArrayInput
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class ArrayInput {
      
        +string kind
        +Input items
    }
    class Input {
        +string kind
        +string description
        +boolean required
        +boolean strict
        +unknown default
        +unknown sample
    }
    ArrayInput *-- Input
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
| items | [Input](Input.md) | The type of items contained in the array (Related Types: [ObjectInput](ObjectInput.md)) |

## Composed Types

The following types are composed within `ArrayInput`:

- [Input](Input.md)

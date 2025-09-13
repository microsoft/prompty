# Output

Represents the output properties of an AI agent.
Each output property can be a simple kind, an array, or an object.

## Class Diagram

```mermaid
---
title: Output
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Output {
        +string name
        +string kind
        +string description
        +boolean required
    }
    class ArrayOutput {
        +string kind
        +Output items
    }
    Output <|-- ArrayOutput
    class ObjectOutput {
        +string kind
        +Output[] properties
    }
    Output <|-- ObjectOutput
```

## Yaml Example

```yaml
name: my-output
kind: string
description: A description of the output property
required: true

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name | string | Name of the output property  |
| kind | string | The data kind of the output property  |
| description | string | A short description of the output property  |
| required | boolean | Whether the output property is required  |

## Child Types

The following types extend `Output`:

- [ArrayOutput](ArrayOutput.md)
- [ObjectOutput](ObjectOutput.md)

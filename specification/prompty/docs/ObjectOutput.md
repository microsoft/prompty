# ObjectOutput

Represents an object output property.
This extends the base Output model to represent a structured object.

## Class Diagram

```mermaid
---
title: ObjectOutput
---
classDiagram
    class ObjectOutput {
        +string kind
        +Output[] properties
    }
    class Output {
        +string name
        +string kind
        +string description
        +boolean required
    }
    ObjectOutput *-- Output
```

## Yaml Example

```yaml
properties:
  property1:
    kind: string
  property2:
    kind: number

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string |   |
| properties | [Output[]](Output.md) | The properties contained in the object  |

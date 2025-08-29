# ObjectOutput

Represents an object output property.
This extends the base Output model to represent a structured object.

## Class Diagram

```mermaid
---
title: ObjectOutput
---
classDiagram
    class Output {
        +string name
        +string type
        +string description
        +boolean required
    }
    class ObjectOutput {
        +string type
        +Output[] properties
    }
    ObjectOutput *-- Output
```





## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | string |   |
| properties | [Output Collection](Output.md) | The properties contained in the object  |



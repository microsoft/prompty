# ArrayOutput

Represents an array output property.
This extends the base Output model to represent an array of items.

## Class Diagram

```mermaid
---
title: ArrayOutput
---
classDiagram
    class Output {
        +string type
        +string description
        +boolean required
    }
    class ObjectOutput {
        +string type
        +Output[] properties
    }
    class ArrayOutput {
        +string type
        +Output items
    }
    ArrayOutput *-- Output
    Output *-- ObjectOutput
```





## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | string |   |
| items | [Output](Output.md) | The type of items contained in the array <p>Related Types:<ul><li>[ObjectOutput](ObjectOutput.md)</li></ul></p> |



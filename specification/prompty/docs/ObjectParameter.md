# ObjectParameter

Represents an object parameter for a tool.

## Class Diagram

```mermaid
---
title: ObjectParameter
---
classDiagram
    class Parameter {
        +string name
        +string type
        +string description
        +boolean required
        +unknown[] enum
    }
    class ArrayParameter {
        +string type
        +Parameter items
    }
    class ObjectParameter {
        +string type
        +Parameter[] properties
    }
    ObjectParameter *-- Parameter
    Parameter *-- ArrayParameter
```





## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | string |   |
| properties | [Parameter Collection](Parameter.md) | The properties of the object parameter <p>Related Types:<ul><li>[ArrayParameter](ArrayParameter.md)</li></ul></p> |



# ArrayParameter

Represents an array parameter for a tool.

## Class Diagram

```mermaid
---
title: ArrayParameter
---
classDiagram
    class Parameter {
        +string type
        +string description
        +boolean required
        +unknown[] enum
    }
    class ArrayParameter {
        +string type
        +Parameter items
    }
    ArrayParameter *-- Parameter
```





## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | string |   |
| items | [Parameter](Parameter.md) | The type of items contained in the array  |



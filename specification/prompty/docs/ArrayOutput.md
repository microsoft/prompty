# ArrayOutput

Represents an array output property.
This extends the base Output model to represent an array of items.

## Class Diagram

```mermaid
---
title: ArrayOutput
---
classDiagram
    class ArrayOutput {
        +string kind
        +Output items
    }
    class Output {
        +string kind
        +string description
        +boolean required
    }
    ArrayOutput *-- Output
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
| items | [Output](Output.md) | The type of items contained in the array <p>Related Types:<ul><li>[ObjectOutput](ObjectOutput.md)</li></ul></p> |




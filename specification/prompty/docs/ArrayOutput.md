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
        +string type
        +Output items
    }
```



## Yaml Example
```yaml
items:
  type: string

```




## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | string |   |
| items | [Output](Output.md) | The type of items contained in the array <p>Related Types:<ul><li>[ObjectOutput](ObjectOutput.md)</li></ul></p> |




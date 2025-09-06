# ArrayParameter

Represents an array parameter for a tool.

## Class Diagram

```mermaid
---
title: ArrayParameter
---
classDiagram
    class ArrayParameter {
        +string type
        +Parameter items
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
| items | [Parameter](Parameter.md) | The type of items contained in the array  |




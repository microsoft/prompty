# ObjectParameter

Represents an object parameter for a tool.

## Class Diagram

```mermaid
---
title: ObjectParameter
---
classDiagram
    class ObjectParameter {
        +string kind
        +Parameter[] properties
    }
```



## Yaml Example
```yaml
properties:
  param1:
    kind: string
  param2:
    kind: number

```




## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string |   |
| properties | [Parameter Collection](Parameter.md) | The properties of the object parameter <p>Related Types:<ul><li>[ArrayParameter](ArrayParameter.md)</li></ul></p> |




# FunctionTool

Represents a local function tool.

## Class Diagram

```mermaid
---
title: FunctionTool
---
classDiagram
    class FunctionTool {
        +string kind
        +Parameter[] parameters
    }
    class Parameter {
        +string name
        +string kind
        +string description
        +boolean required
        +unknown[] enum
    }
    FunctionTool *-- Parameter
```



## Yaml Example
```yaml
kind: function
parameters:
  param1:
    kind: string
  param2:
    kind: number

```




## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for function tools  |
| parameters | [Parameter Collection](Parameter.md) | Parameters accepted by the function tool <p>Related Types:<ul><li>[ObjectParameter](ObjectParameter.md)</li><li>[ArrayParameter](ArrayParameter.md)</li></ul></p> |




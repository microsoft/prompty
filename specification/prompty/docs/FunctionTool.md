# FunctionTool

Represents a local function tool.

## Class Diagram

```mermaid
---
title: FunctionTool
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Tool {
        +string name
        +string kind
        +string description
        +Binding[] bindings
    }
    Tool <|-- FunctionTool
    class FunctionTool {
      
        +string kind
        +Parameter[] parameters
    }
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
| parameters | [Parameter[]](Parameter.md) | Parameters accepted by the function tool  |

---
title: "FunctionTool"
description: "Documentation for the FunctionTool type."
slug: "reference/functiontool"
---

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
        +Property[] parameters
        +boolean strict
    }
```

## Yaml Example

```yaml
kind: function
parameters:
  firstName:
    kind: string
    default: Jane
  lastName:
    kind: string
    default: Doe
  question:
    kind: string
    default: What is the meaning of life?
strict: true
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for function tools |
| parameters | [Property[]](../property/) | Parameters accepted by the function tool |
| strict | boolean | Indicates whether the function tool enforces strict validation on its parameters |

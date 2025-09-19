# Binding

Represents a binding between an input property and a tool parameter.

## Class Diagram

```mermaid
---
title: Binding
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Binding {
      
        +string name
        +string input
    }
```

## Yaml Example

```yaml
name: my-tool
input: input-variable

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name | string | Name of the binding  |
| input | string | The input property that will be bound to the tool parameter argument  |

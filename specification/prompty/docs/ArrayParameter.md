# ArrayParameter

Represents an array parameter for a tool.

## Class Diagram

```mermaid
---
title: ArrayParameter
---
classDiagram
    class ArrayParameter {
        +string kind
        +Parameter items
    }
    class Parameter {
        +string kind
        +string description
        +boolean required
        +unknown[] enum
    }
    ArrayParameter *-- Parameter
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
| items | [Parameter](Parameter.md) | The kind of items contained in the array  |

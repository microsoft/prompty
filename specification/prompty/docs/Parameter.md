# Parameter

Represents a parameter for a tool.

## Class Diagram

```mermaid
---
title: Parameter
---
classDiagram
    class Parameter {
        +string name
        +string kind
        +string description
        +boolean required
        +unknown[] enum
    }
    class ObjectParameter {
        +string kind
        +Parameter[] properties
    }
    Parameter <|-- ObjectParameter
    class ArrayParameter {
        +string kind
        +Parameter items
    }
    Parameter <|-- ArrayParameter
```

## Yaml Example

```yaml
name: my-parameter
kind: string
description: A description of the tool parameter
required: true
enum:
  - value1
  - value2
  - value3

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name | string | Name of the parameter  |
| kind | string | The data type of the tool parameter  |
| description | string | A short description of the property  |
| required | boolean | Whether the tool parameter is required  |
| enum | unknown[] | Allowed enumeration values for the parameter  |

## Child Types

The following types extend `Parameter`:

- [ObjectParameter](ObjectParameter.md)
- [ArrayParameter](ArrayParameter.md)

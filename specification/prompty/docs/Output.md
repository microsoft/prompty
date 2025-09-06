# Output

Represents the output properties of an AI agent.
Each output property can be a simple type, an array, or an object.

## Class Diagram

```mermaid
---
title: Output
---
classDiagram
    class Output {
        +string name
        +string type
        +string description
        +boolean required
    }
    class ArrayOutput {
        +string type
        +Output items
    }
    Output <|-- ArrayOutput
    class ObjectOutput {
        +string type
        +Output[] properties
    }
    Output <|-- ObjectOutput
```



## Yaml Example
```yaml
type: string
description: A description of the output property
required: true

```




## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| name | string | Name of the output property  |
| type | string | The data type of the output property  |
| description | string | A short description of the output property  |
| required | boolean | Whether the output property is required  |



## Child Types

The following types extend `Output`:
- [ArrayOutput](ArrayOutput.md)
- [ObjectOutput](ObjectOutput.md)


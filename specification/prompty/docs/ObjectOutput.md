# ObjectOutput

Represents an object output property.
This extends the base Output model to represent a structured object.

## Class Diagram

```mermaid
---
title: ObjectOutput
---
classDiagram
    class ObjectOutput {
        +string type
        +Output[] properties
    }
```



## Yaml Example
```yaml
properties:
  property1:
    type: string
  property2:
    type: number

```




## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| type | string |   |
| properties | [Output Collection](Output.md) | The properties contained in the object  |




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
        +string kind
        +Output[] properties
    }
```



## Yaml Example
```yaml
properties:
  property1:
    kind: string
  property2:
    kind: number

```




## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string |   |
| properties | [Output Collection](Output.md) | The properties contained in the object  |




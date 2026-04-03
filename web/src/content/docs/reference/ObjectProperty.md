---
title: "ObjectProperty"
description: "Documentation for the ObjectProperty type."
slug: "reference/objectproperty"
---

Represents an object property.
This extends the base Property model to represent a structured object.

## Class Diagram

```mermaid
---
title: ObjectProperty
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Property {
        +string name
        +string kind
        +string description
        +boolean required
        +unknown default
        +unknown example
        +unknown[] enumValues
    }
    Property <|-- ObjectProperty
    class ObjectProperty {
      
        +string kind
        +Property[] properties
    }
    class Property {
        +string name
        +string kind
        +string description
        +boolean required
        +unknown default
        +unknown example
        +unknown[] enumValues
    }
    ObjectProperty *-- Property
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
| kind | string |  |
| properties | [Property[]](../property/) | The properties contained in the object |

## Composed Types

The following types are composed within `ObjectProperty`:

- [Property](../property/)

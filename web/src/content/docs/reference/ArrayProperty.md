---
title: "ArrayProperty"
description: "Documentation for the ArrayProperty type."
slug: "reference/arrayproperty"
---

Represents an array property.
This extends the base Property model to represent an array of items.

## Class Diagram

```mermaid
---
title: ArrayProperty
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
    Property <|-- ArrayProperty
    class ArrayProperty {
      
        +string kind
        +Property items
    }
    class Property {
        +string kind
        +string description
        +boolean required
        +unknown default
        +unknown example
        +unknown[] enumValues
    }
    ArrayProperty *-- Property
```

## Yaml Example

```yaml
items:
  kind: string
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string |  |
| items | [Property](../property/) | The type of items contained in the array(Related Types: [ObjectProperty](../objectproperty/)) |

## Composed Types

The following types are composed within `ArrayProperty`:

- [Property](../property/)

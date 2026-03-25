---
title: "PropertySchema"
description: "Documentation for the PropertySchema type."
slug: "reference/propertyschema"
---

Definition for the property schema of a model.
This includes the properties and example records.

## Class Diagram

```mermaid
---
title: PropertySchema
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class PropertySchema {
      
        +dictionary[] examples
        +boolean strict
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
    PropertySchema *-- Property
```

## Yaml Example

```yaml
examples:
  - key: value
strict: true
properties:
  firstName:
    kind: string
    sample: Jane
  lastName:
    kind: string
    sample: Doe
  question:
    kind: string
    sample: What is the meaning of life?
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| examples | dictionary[] | Example records for the input schema |
| strict | boolean | Whether the input schema is strict - if true, only the defined properties are allowed |
| properties | [Property[]](../property/) | The input properties for the schema(Related Types: [ArrayProperty](../arrayproperty/), [ObjectProperty](../objectproperty/)) |

## Composed Types

The following types are composed within `PropertySchema`:

- [Property](../property/)

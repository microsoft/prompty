# ContainerDefinition

## Class Diagram

```mermaid
---
title: ContainerDefinition
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class ContainerDefinition {
        +string image
        +string tag
        +Registry registry
        +Scale scale
    }
    class Registry {
        +string kind
        +Connection connection
    }
    ContainerDefinition *-- Registry
    class Scale {
        +integer minReplicas
        +integer maxReplicas
        +float cpu
        +float memory
    }
    ContainerDefinition *-- Scale
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| image | string |   |
| tag | string |   |
| registry | [Registry](Registry.md) | Container image registry definition (Related Types: [AzureContainerRegistry](AzureContainerRegistry.md)) |
| scale | [Scale](Scale.md) | Instance scaling configuration  |

## Composed Types

The following types are composed within `ContainerDefinition`:

- [Registry](Registry.md)
- [Scale](Scale.md)

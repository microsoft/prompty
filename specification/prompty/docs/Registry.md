# Registry

Definition for a container image registry.

## Class Diagram

```mermaid
---
title: Registry
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Registry {
      <<abstract>>
        +string kind
        +Connection connection
    }
    class GenericRegistry {
        +string kind
        +string repository
        +string username
        +string password
    }
    Registry <|-- GenericRegistry
    class AzureContainerRegistry {
        +string kind
        +string subscription
        +string resourceGroup
        +string registryName
    }
    Registry <|-- AzureContainerRegistry
```

## Yaml Example

```yaml
kind: docker
connection:
  kind: key
  authority: system
  usageDescription: Access to the container registry

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind of container registry  |
| connection | [Connection](Connection.md) | The connection configuration for accessing the container registry  |

## Child Types

The following types extend `Registry`:

- [GenericRegistry](GenericRegistry.md)
- [AzureContainerRegistry](AzureContainerRegistry.md)

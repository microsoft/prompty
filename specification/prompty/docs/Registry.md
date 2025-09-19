# Registry

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
      
        +string kind
        +Connection connection
    }
    class AzureContainerRegistry {
        +string kind
        +string subscription
        +string resource_group
        +string registry_name
    }
    Registry <|-- AzureContainerRegistry
    class Connection {
        +string kind
        +string authority
        +string usage_description
        +dictionary options
    }
    Registry *-- Connection
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string |   |
| connection | [Connection](Connection.md) |  (Related Types: [ReferenceConnection](ReferenceConnection.md), [KeyConnection](KeyConnection.md), [OAuthConnection](OAuthConnection.md), [FoundryConnection](FoundryConnection.md)) |

## Child Types

The following types extend `Registry`:

- [AzureContainerRegistry](AzureContainerRegistry.md)

## Composed Types

The following types are composed within `Registry`:

- [Connection](Connection.md)

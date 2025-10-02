# GenericRegistry

Definition for a generic container image registry.

## Class Diagram

```mermaid
---
title: GenericRegistry
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
    Registry <|-- GenericRegistry
    class GenericRegistry {
      
        +string kind
        +string repository
        +string username
        +string password
    }
```

## Yaml Example

```yaml
kind: some-value
repository: https://my-registry.com
username: my-username
password: my-password

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind of container registry  |
| repository | string | The URL of the container registry  |
| username | string | The username for accessing the container registry  |
| password | string | The password for accessing the container registry  |

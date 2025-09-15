# PromptyContainer

## Class Diagram

```mermaid
---
title: PromptyContainer
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class PromptyContainer {
        +string kind
        +ContainerDefinition container
        +EnvironmentVariable[] environment_variables
    }
    class ContainerDefinition {
        +string image
        +string tag
        +Registry registry
        +Scale scale
    }
    PromptyContainer *-- ContainerDefinition
    class EnvironmentVariable {
        +string name
        +string value
    }
    PromptyContainer *-- EnvironmentVariable
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | Type of agent, e.g., &#39;prompt&#39; or &#39;container&#39;  |
| container | [ContainerDefinition](ContainerDefinition.md) | Container definition including registry and scaling information  |
| environment_variables | [EnvironmentVariable[]](EnvironmentVariable.md) | Environment variables to set in the hosted agent container.  |

# ModelTool

The MCP Server tool.

## Class Diagram

```mermaid
---
title: ModelTool
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class ModelTool {
      
        +string kind
        +Model model
    }
```

## Yaml Example

```yaml
kind: model
model:
  id: my-model
  provider: my-provider
  connection:
    kind: provider-connection

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for a model connection as a tool  |
| model | [Model](Model.md) | The connection configuration for the model tool  |

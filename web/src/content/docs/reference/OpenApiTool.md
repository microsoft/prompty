---
title: "OpenApiTool"
description: "Documentation for the OpenApiTool type."
slug: "reference/openapitool"
---



## Class Diagram

```mermaid
---
title: OpenApiTool
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Tool {
        +string name
        +string kind
        +string description
        +Binding[] bindings
    }
    Tool <|-- OpenApiTool
    class OpenApiTool {
      
        +string kind
        +Connection connection
        +string specification
    }
```

## Yaml Example

```yaml
kind: openapi
connection:
  kind: reference
specification: full_sepcification_here
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for OpenAPI tools |
| connection | [Connection](../connection/) | The connection configuration for the OpenAPI tool |
| specification | string | The full OpenAPI specification |

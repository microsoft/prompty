# OpenApiTool

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
    class OpenApiTool {
      
        +string kind
        +Connection connection
        +string specification
        +string[] operationIds
    }
```

## Yaml Example

```yaml
kind: openapi
connection:
  kind: provider-connection
specification: https://api.example.com/openapi.json
operationIds:
  - getUser
  - getUsers
  - createUser

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for OpenAPI tools  |
| connection | [Connection](Connection.md) | The connection configuration for the OpenAPI tool  |
| specification | string | The URL or relative path to the OpenAPI specification document (JSON or YAML format)  |
| operationIds | string[] | The name of the operation to be invoked from the OpenAPI specification  |

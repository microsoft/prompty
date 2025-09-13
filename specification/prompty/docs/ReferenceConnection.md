# ReferenceConnection

Connection configuration for AI services using named connections.

## Class Diagram

```mermaid
---
title: ReferenceConnection
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class ReferenceConnection {
        +string kind
        +string name
    }
```

## Yaml Example

```yaml
kind: reference
name: my-reference-connection

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The Authentication kind for the AI service (e.g., &#39;key&#39; for API key, &#39;oauth&#39; for OAuth tokens)  |
| name | string | The name of the connection  |

---
title: "ReferenceConnection"
description: "Documentation for the ReferenceConnection type."
slug: "reference/referenceconnection"
---

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
    class Connection {
        +string kind
        +string authenticationMode
        +string usageDescription
    }
    Connection <|-- ReferenceConnection
    class ReferenceConnection {
      
        +string kind
        +string name
        +string target
    }
```

## Yaml Example

```yaml
kind: reference
name: my-reference-connection
target: my-target-resource
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The Authentication kind for the AI service (e.g., &#39;key&#39; for API key, &#39;oauth&#39; for OAuth tokens) |
| name | string | The name of the connection |
| target | string | The target resource or service that this connection refers to |

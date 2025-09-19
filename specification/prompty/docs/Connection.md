# Connection

Connection configuration for AI agents.
`provider`, `kind`, and `endpoint` are required properties here,
but this section can accept additional via options.

## Class Diagram

```mermaid
---
title: Connection
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Connection {
      <<abstract>>
        +string kind
        +string authority
        +string usageDescription
    }
    class GenericConnection {
        +string kind
        +dictionary options
    }
    Connection <|-- GenericConnection
    class ReferenceConnection {
        +string kind
        +string name
    }
    Connection <|-- ReferenceConnection
    class KeyConnection {
        +string kind
        +string endpoint
        +string key
    }
    Connection <|-- KeyConnection
    class OAuthConnection {
        +string kind
        +string endpoint
        +string clientId
        +string clientSecret
        +string tokenUrl
        +string[] scopes
    }
    Connection <|-- OAuthConnection
    class FoundryConnection {
        +string kind
        +string type
        +string name
        +string project
    }
    Connection <|-- FoundryConnection
```

## Yaml Example

```yaml
kind: oauth
authority: system
usageDescription: This will allow the agent to respond to an email on your behalf

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The Authentication kind for the AI service (e.g., &#39;key&#39; for API key, &#39;oauth&#39; for OAuth tokens)  |
| authority | string | The authority level for the connection, indicating under whose authority the connection is made (e.g., &#39;user&#39;, &#39;agent&#39;, &#39;system&#39;)  |
| usageDescription | string | The usage description for the connection, providing context on how this connection will be used  |

## Child Types

The following types extend `Connection`:

- [GenericConnection](GenericConnection.md)
- [ReferenceConnection](ReferenceConnection.md)
- [KeyConnection](KeyConnection.md)
- [OAuthConnection](OAuthConnection.md)
- [FoundryConnection](FoundryConnection.md)

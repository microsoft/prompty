---
title: "Connection"
description: "Documentation for the Connection type."
slug: "reference/connection"
---

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
        +string authenticationMode
        +string usageDescription
    }
    class ReferenceConnection {
        +string kind
        +string name
        +string target
    }
    Connection <|-- ReferenceConnection
    class RemoteConnection {
        +string kind
        +string name
        +string endpoint
    }
    Connection <|-- RemoteConnection
    class ApiKeyConnection {
        +string kind
        +string endpoint
        +string apiKey
    }
    Connection <|-- ApiKeyConnection
    class AnonymousConnection {
        +string kind
        +string endpoint
    }
    Connection <|-- AnonymousConnection
    class FoundryConnection {
        +string kind
        +string endpoint
        +string name
        +string connectionType
    }
    Connection <|-- FoundryConnection
    class OAuthConnection {
        +string kind
        +string endpoint
        +string clientId
        +string clientSecret
        +string tokenUrl
        +string[] scopes
    }
    Connection <|-- OAuthConnection
```

## Yaml Example

```yaml
kind: reference
authenticationMode: system
usageDescription: This will allow the agent to respond to an email on your behalf
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The Authentication kind for the AI service (e.g., &#39;key&#39; for API key, &#39;oauth&#39; for OAuth tokens) |
| authenticationMode | string | The authority level for the connection, indicating under whose authority the connection is made (e.g., &#39;user&#39;, &#39;agent&#39;, &#39;system&#39;) |
| usageDescription | string | The usage description for the connection, providing context on how this connection will be used |

## Child Types

The following types extend `Connection`:

- [ReferenceConnection](../referenceconnection/)
- [RemoteConnection](../remoteconnection/)
- [ApiKeyConnection](../apikeyconnection/)
- [AnonymousConnection](../anonymousconnection/)
- [FoundryConnection](../foundryconnection/)
- [OAuthConnection](../oauthconnection/)

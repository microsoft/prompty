# Connection

Connection configuration for AI agents.
`provider`, `kind`, and `endpoint` are required properties here,
but this section can accept additional via options.

## Class Diagram

```mermaid
---
title: Connection
---
classDiagram
    class Connection {
        +string kind
        +string authority
        +dictionary options
    }
    class NamedConnection {
        +string kind
        +string name
        +dictionary options
    }
    Connection <|-- NamedConnection
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
```



## Yaml Example
```yaml
kind: key
authority: system

```




## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The Authentication kind for the AI service (e.g., &#39;key&#39; for API key, &#39;oauth&#39; for OAuth tokens)  |
| authority | string | The authority level for the connection, indicating under whose authority the connection is made (e.g., &#39;user&#39;, &#39;agent&#39;, &#39;system&#39;)  |
| options | dictionary | Additional options for the connection  |



## Child Types

The following types extend `Connection`:
- [NamedConnection](NamedConnection.md)
- [KeyConnection](KeyConnection.md)
- [OAuthConnection](OAuthConnection.md)


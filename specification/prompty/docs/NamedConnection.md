# NamedConnection

Connection configuration for AI services using named connections.

## Class Diagram

```mermaid
---
title: NamedConnection
---
classDiagram
    class NamedConnection {
        +string kind
        +string name
        +dictionary options
    }
```



## Yaml Example
```yaml
kind: named
name: my-named-connection

```




## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The Authentication kind for the AI service (e.g., &#39;key&#39; for API key, &#39;oauth&#39; for OAuth tokens)  |
| name | string | The name of the connection  |
| options | dictionary | Additional options for the named connection  |




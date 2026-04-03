---
title: "AnonymousConnection"
description: "Documentation for the AnonymousConnection type."
slug: "reference/anonymousconnection"
---



## Class Diagram

```mermaid
---
title: AnonymousConnection
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
    Connection <|-- AnonymousConnection
    class AnonymousConnection {
      
        +string kind
        +string endpoint
    }
```

## Yaml Example

```yaml
kind: anonymous
endpoint: https://{your-custom-endpoint}.openai.azure.com/
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The Authentication kind for the AI service (e.g., &#39;key&#39; for API key, &#39;oauth&#39; for OAuth tokens) |
| endpoint | string | The endpoint for authenticating with the AI service |

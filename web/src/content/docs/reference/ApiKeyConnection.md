---
title: "ApiKeyConnection"
description: "Documentation for the ApiKeyConnection type."
slug: "reference/apikeyconnection"
---

Connection configuration for AI services using API keys.

## Class Diagram

```mermaid
---
title: ApiKeyConnection
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
    Connection <|-- ApiKeyConnection
    class ApiKeyConnection {
      
        +string kind
        +string endpoint
        +string apiKey
    }
```

## Yaml Example

```yaml
kind: key
endpoint: https://{your-custom-endpoint}.openai.azure.com/
apiKey: your-api-key
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The Authentication kind for the AI service (e.g., &#39;key&#39; for API key, &#39;oauth&#39; for OAuth tokens) |
| endpoint | string | The endpoint URL for the AI service |
| apiKey | string | The API key for authenticating with the AI service |

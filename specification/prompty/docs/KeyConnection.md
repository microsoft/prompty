# KeyConnection

Connection configuration for AI services using API keys.

## Class Diagram

```mermaid
---
title: KeyConnection
---
classDiagram
    class KeyConnection {
        +string authType
        +string endpoint
        +string key
    }
```



## Yaml Example
```yaml
authType: key
endpoint: https://{your-custom-endpoint}.openai.azure.com/
key: your-api-key

```




## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| authType | string | The Authentication type for the AI service (e.g., &#39;key&#39; for API key, &#39;oauth&#39; for OAuth tokens)  |
| endpoint | string | The endpoint URL for the AI service  |
| key | string | The API key for authenticating with the AI service  |




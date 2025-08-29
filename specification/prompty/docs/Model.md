# Model

Model for defining the structure and behavior of AI agents.
Yaml Example:
```yaml
name: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
model:
  id: gpt-35-turbo
  connection:
    provider: azure
    type: chat
    endpoint: https://{your-custom-endpoint}.openai.azure.com/
```

A shorthand representation of the model configuration can also be constructed as
follows:
```yaml
name: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
model: gpt-35-turbo
```
This will be expanded as follows:
```yaml
name: Basic Prompt
description: A basic prompt that uses the GPT-3 chat API to answer questions
model:
  id: gpt-35-turbo
```

## Class Diagram

```mermaid
---
title: Model
---
classDiagram
    class Options {
    }
    class BingSearchConfiguration {
        +string connectionId
        +string instanceName
        +string market
        +string setLang
        +int64 count
        +string freshness
    }
    class BingSearchOptions {
        +BingSearchConfiguration[] configurations
    }
    class FileSearchRankingOptions {
        +string ranker
        +float32 scoreThreshold
    }
    class FileSearchOptions {
        +int32 maxNumResults
        +FileSearchRankingOptions rankingOptions
    }
    class Authentication {
        +string type
        +Options credentials
    }
    class McpToolOptions {
        +string name
        +string url
        +string[] allowed
        +Authentication authentication
    }
    class Connection {
        +string provider
        +string type
        +string endpoint
        +Options options
    }
    class Model {
        +string id
        +Connection connection
    }
    Model *-- Connection
```





## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| id | string | The unique identifier of the model  |
| connection | [Connection](Connection.md) | The connection configuration for the model  |



# Connection

Connection configuration for AI agents.
`provider`, `type`, and `endpoint` are required properties here,
but this section can accept additional via options.

## Class Diagram

```mermaid
---
title: Connection
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
    Connection *-- Options
    Options *-- BingSearchOptions
    Options *-- FileSearchOptions
    Options *-- McpToolOptions
```





## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| provider | string | The unique provider of the connection  |
| type | string | The type of connection used to tell the runtime how to load and execute the agent  |
| endpoint | string | The endpoint URL for the connection  |
| options | [Options](Options.md) | Additional options for model execution <p>Related Types:<ul><li>[BingSearchOptions](BingSearchOptions.md)</li><li>[FileSearchOptions](FileSearchOptions.md)</li><li>[McpToolOptions](McpToolOptions.md)</li></ul></p> |



# BingSearchTool

The Bing search tool.

## Class Diagram

```mermaid
---
title: BingSearchTool
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Tool {
        +string name
        +string kind
        +string description
        +Binding[] bindings
    }
    Tool <|-- BingSearchTool
    class BingSearchTool {
      
        +string kind
        +Connection connection
        +BingSearchConfiguration[] configurations
    }
    class BingSearchConfiguration {
        +string name
        +string market
        +string setLang
        +int64 count
        +string freshness
    }
    BingSearchTool *-- BingSearchConfiguration
```

## Yaml Example

```yaml
kind: bing_search
connection:
  kind: provider-connection
configurations:
  - instanceName: MyBingInstance
    market: en-US
    setLang: en
    count: 10
    freshness: Day

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for Bing search tools  |
| connection | [Connection](Connection.md) | The connection configuration for the Bing search tool  |
| configurations | [BingSearchConfiguration[]](BingSearchConfiguration.md) | The configuration options for the Bing search tool  |

## Composed Types

The following types are composed within `BingSearchTool`:

- [BingSearchConfiguration](BingSearchConfiguration.md)

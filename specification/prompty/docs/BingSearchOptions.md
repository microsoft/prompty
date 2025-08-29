# BingSearchOptions

Options for the Bing search tool.

## Class Diagram

```mermaid
---
title: BingSearchOptions
---
classDiagram
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
    BingSearchOptions *-- BingSearchConfiguration
```





## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| configurations | [BingSearchConfiguration Collection](BingSearchConfiguration.md) |   |



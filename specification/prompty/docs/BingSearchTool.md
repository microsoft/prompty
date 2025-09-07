# BingSearchTool

The Bing search tool.

## Class Diagram

```mermaid
---
title: BingSearchTool
---
classDiagram
    class BingSearchTool {
        +string kind
        +Connection connection
        +BingSearchOptions options
    }
```






## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for Bing search tools  |
| connection | [Connection](Connection.md) | The connection configuration for the Bing search tool  |
| options | [BingSearchOptions](BingSearchOptions.md) | The options for the Bing search tool  |




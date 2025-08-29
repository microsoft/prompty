# FileSearchOptions

Options for file search.

## Class Diagram

```mermaid
---
title: FileSearchOptions
---
classDiagram
    class FileSearchOptions {
        +int32 maxNumResults
        +FileSearchRankingOptions rankingOptions
    }
    FileSearchOptions *-- FileSearchRankingOptions
```





## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| maxNumResults | int32 | The maximum number of search results to return.  |
| rankingOptions | [FileSearchRankingOptions](FileSearchRankingOptions.md) | Options for ranking file search results.  |



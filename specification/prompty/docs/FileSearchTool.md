# FileSearchTool

A tool for searching files.
This tool allows an AI agent to search for files based on a query.

## Class Diagram

```mermaid
---
title: FileSearchTool
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
    Tool <|-- FileSearchTool
    class FileSearchTool {
      
        +string kind
        +Connection connection
        +int32 maxNumResults
        +string ranker
        +float32 scoreThreshold
    }
```

## Yaml Example

```yaml
kind: file_search
connection:
  kind: provider-connection
maxNumResults: 10
ranker: default
scoreThreshold: 0.5

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for file search tools  |
| connection | [Connection](Connection.md) | The connection configuration for the file search tool  |
| maxNumResults | int32 | The maximum number of search results to return.  |
| ranker | string | File search ranker.  |
| scoreThreshold | float32 | Ranker search threshold.  |

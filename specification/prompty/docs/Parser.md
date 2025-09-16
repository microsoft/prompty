# Parser

## Class Diagram

```mermaid
---
title: Parser
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Parser {
        +string kind
        +dictionary options
    }
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | Parser used to process the rendered template into API-compatible format  |
| options | dictionary | Options for the parser  |

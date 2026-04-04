---
title: "ParserConfig"
description: "Documentation for the ParserConfig type."
slug: "reference/parserconfig"
---

Template parser definition

## Class Diagram

```mermaid
---
title: ParserConfig
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class ParserConfig {
      
        +string kind
        +dictionary options
    }
```

## Yaml Example

```yaml
kind: prompty
options:
  key: value
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | Parser used to process the rendered template into API-compatible format |
| options | dictionary | Options for the parser |

## Alternate Constructions

The following alternate constructions are available for `ParserConfig`.
These allow for simplified creation of instances using a single property.

### string parser

Simple construction with just a &quot;kind&quot; string

The following simplified representation can be used:

```yaml
parser: "example"
```

This is equivalent to the full representation:

```yaml
parser:
  kind: "example"
```

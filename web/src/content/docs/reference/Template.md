---
title: "Template"
description: "Documentation for the Template type."
slug: "reference/template"
---

Template model for defining prompt templates.

This model specifies the rendering engine used for slot filling prompts,
the parser used to process the rendered template into API-compatible format,
and additional options for the template engine.

It allows for the creation of reusable templates that can be filled with dynamic data
and processed to generate prompts for AI models.

## Class Diagram

```mermaid
---
title: Template
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Template {
      
        +FormatConfig format
        +ParserConfig parser
    }
    class FormatConfig {
        +string kind
        +boolean strict
        +dictionary options
    }
    Template *-- FormatConfig
    class ParserConfig {
        +string kind
        +dictionary options
    }
    Template *-- ParserConfig
```

## Yaml Example

```yaml
format:
  kind: mustache
parser:
  kind: mustache
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| format | [FormatConfig](../formatconfig/) | Template rendering engine used for slot filling prompts (e.g., mustache, jinja2) |
| parser | [ParserConfig](../parserconfig/) | Parser used to process the rendered template into API-compatible format |

## .prompty Examples

### Jinja2 template (default)

```yaml
---
name: greet
template:
  format:
    kind: jinja2
  parser:
    kind: prompty
---
system:
Hello {{ name }}, welcome!
```

### Mustache template

```yaml
---
name: greet
template:
  format:
    kind: mustache
  parser:
    kind: prompty
---
system:
Hello {{name}}, welcome!
```

## Composed Types

The following types are composed within `Template`:

- [FormatConfig](../formatconfig/)
- [ParserConfig](../parserconfig/)

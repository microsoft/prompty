# Template

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
---
classDiagram
    class Template {
        +string format
        +string parser
        +boolean strict
        +dictionary options
    }
```

## Yaml Example

```yaml
format: handlebars
parser: prompty
strict: false
options:
  trimBlocks: true
  lstripBlocks: true

```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| format | string | Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)  |
| parser | string | Parser used to process the rendered template into API-compatible format  |
| strict | boolean | Whether the template can emit structural text for parsing output  |
| options | dictionary | Additional options for the template engine  |

# Format

## Class Diagram

```mermaid
---
title: Format
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class Format {
        +string kind
        +boolean strict
        +dictionary options
    }
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)  |
| strict | boolean | Whether the template can emit structural text for parsing output  |
| options | dictionary | Options for the template engine  |

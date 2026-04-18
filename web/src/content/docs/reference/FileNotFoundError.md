---
title: "FileNotFoundError"
description: "Documentation for the FileNotFoundError type."
slug: "reference/filenotfounderror"
---

Raised when a referenced file cannot be found. This applies to both
.prompty files and ${file:path} references in frontmatter.

## Class Diagram

```mermaid
---
title: FileNotFoundError
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class FileNotFoundError {
        +string message
        +string path
    }
```

## Yaml Example

```yaml
message: "Prompty file not found: ./chat.prompty"
path: ./chat.prompty
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| message | string | Human-readable error message |
| path | string | The file path that could not be resolved |

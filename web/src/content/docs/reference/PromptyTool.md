---
title: "PromptyTool"
description: "Documentation for the PromptyTool type."
slug: "reference/promptytool"
---

A tool that references another .prompty file to be invoked as a tool.

The child prompty is loaded, rendered, and executed with a single LLM call
(invoke). Apps that want agentic sub-agents should use `kind: function` tools
and call `turn()` themselves.

## Class Diagram

```mermaid
---
title: PromptyTool
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
    Tool <|-- PromptyTool
    class PromptyTool {
      
        +string kind
        +string path
    }
```

## Yaml Example

```yaml
kind: prompty
path: ./summarize.prompty
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| kind | string | The kind identifier for prompty tools |
| path | string | Path to the child .prompty file, relative to the parent |

---
title: "AnthropicWireMessage"
description: "Documentation for the AnthropicWireMessage type."
slug: "reference/anthropicwiremessage"
---

A single message in the Anthropic Messages API wire format.
Anthropic always uses the array-of-blocks form for content,
even when there is only one text block (§7.5).

## Class Diagram

```mermaid
---
title: AnthropicWireMessage
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class AnthropicWireMessage {
        +string role
        +unknown[] content
    }
```

## Yaml Example

```yaml
role: user
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| role | string | The message role ('user' or 'assistant') |
| content | unknown[] | Array of typed content blocks (AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock) |

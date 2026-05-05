---
title: "DoneEventPayload"
description: "Documentation for the DoneEventPayload type."
slug: "reference/doneeventpayload"
---

Payload for "done" events — the agent loop completed successfully.

## Class Diagram

```mermaid
---
title: DoneEventPayload
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class DoneEventPayload {
        +string response
        +Message[] messages
    }
    class Message {
        +string role
        +ContentPart[] parts
        +dictionary metadata
        +toTextContent() unknown [async-capable]
        +text() string [async-capable]
    }
    DoneEventPayload *-- Message
```

## Yaml Example

```yaml
response: The weather in Paris is 72°F and sunny.
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| response | string | The final text response from the LLM |
| messages | [Message[]](../message/) | The final conversation state including all messages |

## Composed Types

The following types are composed within `DoneEventPayload`:

- [Message](../message/)

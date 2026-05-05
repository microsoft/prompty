---
title: "MessagesUpdatedPayload"
description: "Documentation for the MessagesUpdatedPayload type."
slug: "reference/messagesupdatedpayload"
---

Payload for "messages_updated" events — the conversation state has changed.

## Class Diagram

```mermaid
---
title: MessagesUpdatedPayload
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class MessagesUpdatedPayload {
        +Message[] messages
    }
    class Message {
        +string role
        +ContentPart[] parts
        +dictionary metadata
        +toTextContent() unknown [async-capable]
        +text() string [async-capable]
    }
    MessagesUpdatedPayload *-- Message
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| messages | [Message[]](../message/) | The current full message list after the update |

## Composed Types

The following types are composed within `MessagesUpdatedPayload`:

- [Message](../message/)

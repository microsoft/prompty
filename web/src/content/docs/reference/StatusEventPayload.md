---
title: "StatusEventPayload"
description: "Documentation for the StatusEventPayload type."
slug: "reference/statuseventpayload"
---

Payload for "status" events — informational messages about loop progress.

## Class Diagram

```mermaid
---
title: StatusEventPayload
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class StatusEventPayload {
        +string message
    }
```

## Yaml Example

```yaml
message: Starting iteration 3
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| message | string | Human-readable status message |

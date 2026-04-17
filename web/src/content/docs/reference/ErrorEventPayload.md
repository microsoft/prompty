---
title: "ErrorEventPayload"
description: "Documentation for the ErrorEventPayload type."
slug: "reference/erroreventpayload"
---

Payload for "error" events — an error occurred during the loop.

## Class Diagram

```mermaid
---
title: ErrorEventPayload
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class ErrorEventPayload {
        +string message
    }
```

## Yaml Example

```yaml
message: Rate limit exceeded
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| message | string | Human-readable error description |

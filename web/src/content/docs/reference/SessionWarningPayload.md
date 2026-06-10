---
title: "SessionWarningPayload"
description: "Documentation for the SessionWarningPayload type."
slug: "reference/sessionwarningpayload"
---

Payload for "session_warning" events.

## Class Diagram

```mermaid
---
title: SessionWarningPayload
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class SessionWarningPayload {
        +string warningType
        +string message
        +dictionary details
    }
```

## Yaml Example

```yaml
warningType: remote
message: Remote session disabled
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| warningType | string | Stable machine-readable warning category |
| message | string | Human-readable warning message |
| details | dictionary | Additional host-specific warning details |

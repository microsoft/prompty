---
title: "HookStartPayload"
description: "Documentation for the HookStartPayload type."
slug: "reference/hookstartpayload"
---

Payload for "hook_start" events — a host lifecycle hook is beginning.

## Class Diagram

```mermaid
---
title: HookStartPayload
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class HookStartPayload {
        +string hookInvocationId
        +string hookType
        +dictionary input
        +RedactionMetadata redaction
    }
    class RedactionMetadata {
        +boolean sanitized
        +RedactedField[] fields
        +string policy
    }
    HookStartPayload *-- RedactionMetadata
```

## Yaml Example

```yaml
hookInvocationId: hook_abc123
hookType: preToolUse
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| hookInvocationId | string | Stable hook invocation identifier |
| hookType | string | Host-defined hook type |
| input | dictionary | Hook input after host-side sanitization |
| redaction | [RedactionMetadata](../redactionmetadata/) | Redaction state for sensitive hook input fields |

## Composed Types

The following types are composed within `HookStartPayload`:

- [RedactionMetadata](../redactionmetadata/)

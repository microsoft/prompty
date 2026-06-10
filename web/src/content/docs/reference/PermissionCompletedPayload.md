---
title: "PermissionCompletedPayload"
description: "Documentation for the PermissionCompletedPayload type."
slug: "reference/permissioncompletedpayload"
---

Payload for permission completion events — an approval decision was made.

## Class Diagram

```mermaid
---
title: PermissionCompletedPayload
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class PermissionCompletedPayload {
        +string permission
        +boolean approved
        +string reason
    }
```

## Yaml Example

```yaml
permission: tool.execute
approved: true
reason: user_approved
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| permission | string | Permission/action name that was decided |
| approved | boolean | Whether the requested permission was approved |
| reason | string | Decision reason, if available |

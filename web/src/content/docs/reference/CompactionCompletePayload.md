---
title: "CompactionCompletePayload"
description: "Documentation for the CompactionCompletePayload type."
slug: "reference/compactioncompletepayload"
---

Payload for "compaction_complete" events — context compaction finished.

## Class Diagram

```mermaid
---
title: CompactionCompletePayload
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class CompactionCompletePayload {
        +int32 removed
        +int32 remaining
    }
```

## Yaml Example

```yaml
removed: 5
remaining: 3
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| removed | int32 | Number of messages removed during compaction |
| remaining | int32 | Number of messages remaining after compaction |

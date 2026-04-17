---
title: "GuardrailError"
description: "Documentation for the GuardrailError type."
slug: "reference/guardrailerror"
---

Data carried by a GuardrailError — raised when an input or output
guardrail denies content. The reason field explains the denial
for logging, UI display, or programmatic handling.

## Class Diagram

```mermaid
---
title: GuardrailError
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class GuardrailError {
        +string reason
    }
```

## Yaml Example

```yaml
reason: Content contains personally identifiable information
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| reason | string | Explanation of why the guardrail denied the content |

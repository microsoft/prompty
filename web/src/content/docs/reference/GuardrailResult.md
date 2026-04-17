---
title: "GuardrailResult"
description: "Documentation for the GuardrailResult type."
slug: "reference/guardrailresult"
---

The result of a guardrail evaluation. Guardrails are safety checks that
run at specific phases of the agent loop and can allow, deny, or rewrite
content.

## Class Diagram

```mermaid
---
title: GuardrailResult
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class GuardrailResult {
        +boolean allowed
        +string reason
        +unknown rewrite
    }
```

## Yaml Example

```yaml
allowed: true
reason: Content is safe
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| allowed | boolean | Whether the content passed the guardrail check |
| reason | string | Explanation of why the content was allowed or denied |
| rewrite | unknown | Optional rewritten content to replace the original |

## Factory Methods

The following factory methods are declared via `@factory` and are generated automatically by the emitter in every language.

- `rewrite(rewrite: unknown)`
- `deny(reason: string)`
- `allow()`

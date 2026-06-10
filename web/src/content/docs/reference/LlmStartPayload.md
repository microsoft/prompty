---
title: "LlmStartPayload"
description: "Documentation for the LlmStartPayload type."
slug: "reference/llmstartpayload"
---

Payload for "llm_start" events — an LLM request is about to be sent.

## Class Diagram

```mermaid
---
title: LlmStartPayload
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class LlmStartPayload {
        +string provider
        +string modelId
        +int32 messageCount
        +int32 attempt
    }
```

## Yaml Example

```yaml
provider: openai
modelId: gpt-4o-mini
messageCount: 4
attempt: 0
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| provider | string | Provider identifier used for the request |
| modelId | string | Model or deployment identifier used for the request |
| messageCount | int32 | Number of messages sent to the provider |
| attempt | int32 | Retry attempt number, zero for the initial attempt |

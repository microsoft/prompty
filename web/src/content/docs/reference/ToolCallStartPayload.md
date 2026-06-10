---
title: "ToolCallStartPayload"
description: "Documentation for the ToolCallStartPayload type."
slug: "reference/toolcallstartpayload"
---

Payload for "tool_call_start" events — the LLM has requested a tool call.

## Class Diagram

```mermaid
---
title: ToolCallStartPayload
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class ToolCallStartPayload {
        +string id
        +string name
        +string arguments
    }
```

## Yaml Example

```yaml
id: call_abc123
name: get_weather
arguments: '{"city": "Paris"}'
```

## Properties

| Name | Type | Description |
| ---- | ---- | ----------- |
| id | string | The unique identifier of the tool call |
| name | string | The name of the tool being called |
| arguments | string | The serialized JSON arguments for the tool call |

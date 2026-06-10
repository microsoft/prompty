---
title: "TraceWriter"
description: "Documentation for the TraceWriter type."
slug: "reference/tracewriter"
---

Persists typed events to a replayable trace.

## Class Diagram

```mermaid
---
title: TraceWriter
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram
    class TraceWriter {
      <<protocol>>
        +appendTurn(turnEvent: TurnEvent) boolean [sync]
        +appendSession(sessionEvent: SessionEvent) boolean [sync]
        +close(summary: SessionSummary?) boolean [sync]
    }
```

## Helper Methods

The following helper methods are declared via `@method` and must be implemented by every runtime. The schema declares the logical protocol contract; each runtime maps async-capable methods to idiomatic sync/async shapes for that language.

| Name | Signature | Runtime shape | Description |
| ---- | --------- | ------------- | ----------- |
| `appendTurn` | `appendTurn(turnEvent: TurnEvent) -> boolean` | sync | Append a turn event to a replayable trace |
| `appendSession` | `appendSession(sessionEvent: SessionEvent) -> boolean` | sync | Append a session event to a replayable trace |
| `close` | `close(summary: SessionSummary?) -> boolean` | sync | Finalize the trace with an optional session summary |

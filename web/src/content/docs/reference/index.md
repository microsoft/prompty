---
title: "Prompty Schema"
description: "Overview of generated Prompty schema types."
slug: "reference"
sidebar:
  order: 1
---

This reference is generated from the in-repository TypeSpec model under
`schema/model/`. It documents the Prompty data model: the fields accepted in
`.prompty` frontmatter, runtime configuration objects, tool definitions,
message shapes, protocol contracts, events, and provider wire helper types.

Use this page for a map of the schema. Use each type page for field details,
examples, child types, helper methods, and alternate constructions. For public
functions, see the [API Reference](/api-reference/). Runtime behavior for these
types is specified in the [Prompty Specification](/specification/).

## Source of Truth

- Type shapes are defined in `schema/model/**/*.tsp`.
- Generated runtime models are checked in under each runtime's `model`
  directory.
- Generated Markdown reference pages are checked in here under
  `web/src/content/docs/reference/`.
- If a generated page looks stale, update the TypeSpec or emitter and run
  `cd schema && npm run build` rather than editing generated reference pages
  by hand.

## Prompt File Core

```mermaid
classDiagram
    class Model {
        +string id
        +string provider
        +string apiType
        +Connection connection
        +ModelOptions options
    }
    class Template {
        +FormatConfig format
        +ParserConfig parser
    }
    class FormatConfig {
        +string kind
        +boolean strict
        +dictionary options
    }
    class ParserConfig {
        +string kind
        +dictionary options
    }
    class Property {
        +string name
        +string kind
        +string description
        +boolean required
        +unknown default
        +unknown example
        +unknown[] enumValues
    }
    class Tool {
      <<abstract>>
        +string name
        +string kind
        +string description
        +Binding[] bindings
    }
    Template *-- FormatConfig
    Template *-- ParserConfig
```

## Properties and Schemas

```mermaid
classDiagram
    class Property {
        +string name
        +string kind
        +string description
        +boolean required
        +unknown default
        +unknown example
        +unknown[] enumValues
    }
    class ObjectProperty {
        +string kind
        +Property[] properties
    }
    class ArrayProperty {
        +string kind
        +Property items
    }
    Property <|-- ArrayProperty
    Property <|-- ObjectProperty
    ObjectProperty *-- Property
    ArrayProperty *-- Property
```

## Models and Connections

```mermaid
classDiagram
    class Model {
        +string id
        +string provider
        +string apiType
        +Connection connection
        +ModelOptions options
    }
    class ModelOptions {
        +float32 frequencyPenalty
        +int32 maxOutputTokens
        +float32 presencePenalty
        +int32 seed
        +float32 temperature
        +int32 topK
        +float32 topP
        +string[] stopSequences
        +boolean allowMultipleToolCalls
        +dictionary additionalProperties
    }
    class Connection {
      <<abstract>>
        +string kind
        +string authenticationMode
        +string usageDescription
    }
    class ApiKeyConnection {
        +string kind
        +string endpoint
        +string apiKey
    }
    class ReferenceConnection {
        +string kind
        +string name
        +string target
    }
    class RemoteConnection {
        +string kind
        +string name
        +string endpoint
    }
    class AnonymousConnection {
        +string kind
        +string endpoint
    }
    class OAuthConnection {
        +string kind
        +string endpoint
        +string clientId
        +string clientSecret
        +string tokenUrl
        +string[] scopes
    }
    class FoundryConnection {
        +string kind
        +string endpoint
        +string name
        +string connectionType
    }
    Connection <|-- ReferenceConnection
    Connection <|-- RemoteConnection
    Connection <|-- ApiKeyConnection
    Connection <|-- AnonymousConnection
    Connection <|-- OAuthConnection
    Connection <|-- FoundryConnection
    Model *-- Connection
    Model *-- ModelOptions
```

## Tools

```mermaid
classDiagram
    class Tool {
      <<abstract>>
        +string name
        +string kind
        +string description
        +Binding[] bindings
    }
    class Binding {
        +string name
        +string input
    }
    class FunctionTool {
        +string kind
        +Property[] parameters
        +boolean strict
    }
    class PromptyTool {
        +string kind
        +string path
        +string mode
    }
    class McpTool {
        +string kind
        +Connection connection
        +string serverName
        +string serverDescription
        +McpApprovalMode approvalMode
        +string[] allowedTools
    }
    class McpApprovalMode {
        +string kind
        +string[] alwaysRequireApprovalTools
        +string[] neverRequireApprovalTools
    }
    class OpenApiTool {
        +string kind
        +Connection connection
        +string specification
    }
    class CustomTool {
        +string kind
        +Connection connection
        +dictionary options
    }
    class Connection {
      <<abstract>>
        +string kind
        +string authenticationMode
        +string usageDescription
    }
    class Property {
        +string name
        +string kind
        +string description
        +boolean required
        +unknown default
        +unknown example
        +unknown[] enumValues
    }
    Tool <|-- FunctionTool
    Tool <|-- CustomTool
    Tool <|-- McpTool
    Tool <|-- OpenApiTool
    Tool <|-- PromptyTool
    Tool *-- Binding
    FunctionTool *-- Property
    CustomTool *-- Connection
    McpTool *-- Connection
    McpTool *-- McpApprovalMode
    OpenApiTool *-- Connection
```

## Messages, Tool Calls, and Streaming

```mermaid
classDiagram
    class Message {
        +string role
        +ContentPart[] parts
        +dictionary metadata
        +toTextContent() unknown [async-capable]
        +text() string [async-capable]
    }
    class ContentPart {
      <<abstract>>
        +string kind
    }
    class TextPart {
        +string kind
        +string value
    }
    class ImagePart {
        +string kind
        +string source
        +string detail
        +string mediaType
    }
    class FilePart {
        +string kind
        +string source
        +string mediaType
    }
    class AudioPart {
        +string kind
        +string source
        +string mediaType
    }
    class ToolCall {
        +string id
        +string name
        +string arguments
    }
    class ToolResult {
        +ContentPart[] parts
        +string status
        +string errorKind
        +string errorMessage
        +float64 durationMs
        +text() string [async-capable]
    }
    class ToolDispatchResult {
        +string toolCallId
        +string name
        +ToolResult result
    }
    class StreamChunk {
      <<abstract>>
        +string kind
    }
    class TextChunk {
        +string kind
        +string value
    }
    class ThinkingChunk {
        +string kind
        +string value
    }
    class ToolChunk {
        +string kind
        +ToolCall toolCall
    }
    class ErrorChunk {
        +string kind
        +string message
    }
    ContentPart <|-- TextPart
    ContentPart <|-- ImagePart
    ContentPart <|-- FilePart
    ContentPart <|-- AudioPart
    StreamChunk <|-- TextChunk
    StreamChunk <|-- ThinkingChunk
    StreamChunk <|-- ToolChunk
    StreamChunk <|-- ErrorChunk
    Message *-- ContentPart
    ToolResult *-- ContentPart
    ToolDispatchResult *-- ToolResult
    ToolChunk *-- ToolCall
```

## Agentic Runtime Controls

```mermaid
classDiagram
    class TurnOptions {
        +int32 maxIterations
        +int32 maxLlmRetries
        +int32 contextBudget
        +boolean parallelToolCalls
        +boolean raw
        +int32 turn
        +CompactionConfig compaction
    }
    class CompactionConfig {
        +string strategy
        +int32 budget
        +dictionary options
    }
    class GuardrailResult {
        +boolean allowed
        +string reason
        +unknown rewrite
    }
    TurnOptions *-- CompactionConfig
```

## Token and Status Events

```mermaid
classDiagram
    class TokenEventPayload {
        +string token
    }
    class ThinkingEventPayload {
        +string token
    }
    class StatusEventPayload {
        +string message
    }
    class ErrorEventPayload {
        +string message
        +string errorKind
        +string phase
    }
```

## Tool and Message Events

```mermaid
classDiagram
    class ToolCallStartPayload {
        +string id
        +string name
        +string arguments
    }
    class ToolResultPayload {
        +string name
        +ToolResult result
    }
    class MessagesUpdatedPayload {
        +Message[] messages
        +string reason
        +Message[] appended
        +int32 removed
    }
    class ToolResult {
        +ContentPart[] parts
        +string status
        +string errorKind
        +string errorMessage
        +float64 durationMs
        +text() string [async-capable]
    }
    class Message {
        +string role
        +ContentPart[] parts
        +dictionary metadata
        +toTextContent() unknown [async-capable]
        +text() string [async-capable]
    }
    ToolResultPayload *-- ToolResult
    MessagesUpdatedPayload *-- Message
    MessagesUpdatedPayload *-- Message
```

## Turn Completion and Compaction Events

```mermaid
classDiagram
    class DoneEventPayload {
        +unknown response
        +Message[] messages
    }
    class CompactionCompletePayload {
        +int32 removed
        +int32 remaining
        +int32 summaryLength
    }
    class CompactionFailedPayload {
        +string message
    }
    class Message {
        +string role
        +ContentPart[] parts
        +dictionary metadata
        +toTextContent() unknown [async-capable]
        +text() string [async-capable]
    }
    DoneEventPayload *-- Message
```

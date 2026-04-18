---
title: "AgentSchema"
description: "Overview of declarative agent types in AgentSchema."
slug: "reference"
sidebar:
  order: 1
---

The following diagram illustrates the classes and their relationships for declarative agents.
The root [object](agentdefinition/) represents the main entry point for the system.

```mermaid
---
title: AgentDefinition and Related Types
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
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
    class Connection {
      <<abstract>>
        +string kind
        +string authenticationMode
        +string usageDescription
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
    class ApiKeyConnection {
        +string kind
        +string endpoint
        +string apiKey
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
    class Model {
        +string id
        +string provider
        +string apiType
        +Connection connection
        +ModelOptions options
    }
    class Binding {
        +string name
        +string input
    }
    class Tool {
      <<abstract>>
        +string name
        +string kind
        +string description
        +Binding[] bindings
    }
    class FunctionTool {
        +string kind
        +Property[] parameters
        +boolean strict
    }
    class CustomTool {
        +string kind
        +Connection connection
        +dictionary options
    }
    class McpApprovalMode {
        +string kind
        +string[] alwaysRequireApprovalTools
        +string[] neverRequireApprovalTools
    }
    class McpTool {
        +string kind
        +Connection connection
        +string serverName
        +string serverDescription
        +McpApprovalMode approvalMode
        +string[] allowedTools
    }
    class OpenApiTool {
        +string kind
        +Connection connection
        +string specification
    }
    class PromptyTool {
        +string kind
        +string path
        +string mode
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
    class Template {
        +FormatConfig format
        +ParserConfig parser
    }
    class Prompty {
        +string name
        +string displayName
        +string description
        +dictionary metadata
        +Property[] inputs
        +Property[] outputs
        +Model model
        +Tool[] tools
        +Template template
        +string instructions
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
    class Message {
        +string role
        +ContentPart[] parts
        +dictionary metadata
    }
    class ToolContext {
        +Message[] messages
        +dictionary metadata
    }
    class ToolResult {
        +ContentPart[] parts
    }
    class ToolDispatchResult {
        +string toolCallId
        +string name
        +ToolResult result
    }
    class ToolCall {
        +string id
        +string name
        +string arguments
    }
    class GuardrailResult {
        +boolean allowed
        +string reason
        +unknown rewrite
    }
    class ThreadMarker {
        +string name
        +string kind
    }
    class TokenUsage {
        +int32 promptTokens
        +int32 completionTokens
        +int32 totalTokens
    }
    class ModelInfo {
        +string id
        +string displayName
        +string ownedBy
        +int32 contextWindow
        +string[] inputModalities
        +string[] outputModalities
        +dictionary additionalProperties
    }
    class CompactionConfig {
        +string strategy
        +int32 budget
        +dictionary options
    }
    class TurnOptions {
        +int32 maxIterations
        +int32 maxLlmRetries
        +int32 contextBudget
        +boolean parallelToolCalls
        +boolean raw
        +int32 turn
        +CompactionConfig compaction
    }
    class Renderer {
    }
    class Parser {
    }
    class Executor {
    }
    class Processor {
    }
    class TokenEventPayload {
        +string token
    }
    class ThinkingEventPayload {
        +string token
    }
    class ToolCallStartPayload {
        +string name
        +string arguments
    }
    class ToolResultPayload {
        +string name
        +ToolResult result
    }
    class StatusEventPayload {
        +string message
    }
    class MessagesUpdatedPayload {
        +Message[] messages
    }
    class DoneEventPayload {
        +string response
        +Message[] messages
    }
    class ErrorEventPayload {
        +string message
    }
    class CompactionCompletePayload {
        +int32 removed
        +int32 remaining
    }
    class CompactionFailedPayload {
        +string message
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
    Property <|-- ArrayProperty
    Property <|-- ObjectProperty
    Connection <|-- ReferenceConnection
    Connection <|-- RemoteConnection
    Connection <|-- ApiKeyConnection
    Connection <|-- AnonymousConnection
    Connection <|-- OAuthConnection
    Connection <|-- FoundryConnection
    Tool <|-- FunctionTool
    Tool <|-- CustomTool
    Tool <|-- McpTool
    Tool <|-- OpenApiTool
    Tool <|-- PromptyTool
    ContentPart <|-- TextPart
    ContentPart <|-- ImagePart
    ContentPart <|-- FilePart
    ContentPart <|-- AudioPart
    StreamChunk <|-- TextChunk
    StreamChunk <|-- ThinkingChunk
    StreamChunk <|-- ToolChunk
    StreamChunk <|-- ErrorChunk
    ObjectProperty *-- Property
    ArrayProperty *-- Property
    Model *-- Connection
    Model *-- ModelOptions
    Tool *-- Binding
    FunctionTool *-- Property
    CustomTool *-- Connection
    McpTool *-- Connection
    McpTool *-- McpApprovalMode
    OpenApiTool *-- Connection
    Template *-- FormatConfig
    Template *-- ParserConfig
    Prompty *-- Property
    Prompty *-- Property
    Prompty *-- Model
    Prompty *-- Tool
    Prompty *-- Template
    Message *-- ContentPart
    ToolContext *-- Message
    ToolResult *-- ContentPart
    ToolDispatchResult *-- ToolResult
    TurnOptions *-- CompactionConfig
    ToolResultPayload *-- ToolResult
    MessagesUpdatedPayload *-- Message
    DoneEventPayload *-- Message
    ToolChunk *-- ToolCall
```

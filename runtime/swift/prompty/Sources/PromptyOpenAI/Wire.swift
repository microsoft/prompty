import Foundation

/// Wire-format projection for the OpenAI Chat Completions and Responses APIs.
///
/// Every function here mirrors the Rust reference implementation so all runtimes
/// produce identical request bodies for the shared `spec/vectors/wire` contract.
import Prompty

import PromptyModel

public enum OpenAIWire {

  // MARK: - Messages

  /// Project a message onto the Chat Completions wire shape.
  public static func message(_ message: Message) -> [String: Any] {
    var wire: [String: Any] = ["role": message.role.rawValue]

    for (key, value) in message.metadata where key != "role" && key != "content" {
      wire[key] = value
    }

    if let text = message.plainTextWireContent {
      wire["content"] = text
    } else {
      wire["content"] = message.parts.map(part)
    }
    return wire
  }

  /// Project a single content part onto its typed wire block.
  public static func part(_ part: ContentPart) -> [String: Any] {
    switch part {
    case .textPart(let text):
      return ["type": "text", "text": text.value]

    case .imagePart(let image):
      var url: [String: Any] = ["url": image.source]
      if let detail = image.detail { url["detail"] = detail }
      return ["type": "image_url", "image_url": url]

    case .audioPart(let audio):
      let format = audio.mediaType.map(audioFormat) ?? "wav"
      return ["type": "input_audio", "input_audio": ["data": audio.source, "format": format]]

    case .filePart(let file):
      return ["type": "file", "file": ["url": file.source]]
    }
  }

  /// Map an audio MIME type onto OpenAI's `format` token.
  public static func audioFormat(_ mime: String) -> String {
    switch mime {
    case "audio/wav", "audio/x-wav": return "wav"
    case "audio/mpeg", "audio/mp3": return "mp3"
    case "audio/mp4": return "mp4"
    case "audio/ogg": return "ogg"
    case "audio/flac": return "flac"
    case "audio/webm": return "webm"
    case "audio/pcm": return "pcm"
    default:
      guard mime.hasPrefix("audio/") else { return "wav" }
      return String(mime.dropFirst("audio/".count))
    }
  }

  // MARK: - Request bodies

  /// Build the request body for a chat completions call.
  public static func chatArgs(_ agent: Agent, messages: [Message]) throws -> [String: Any] {
    var args: [String: Any] = [
      "model": agent.modelId,
      "messages": messages.map(message),
    ]

    applyOptions(&args, agent.modelOptions, provider: "openai")

    let tools = try self.tools(agent)
    if !tools.isEmpty { args["tools"] = tools }

    if let format = try responseFormat(agent) {
      args["response_format"] = format
    }
    return args
  }

  /// Build the request body for the Responses API.
  ///
  /// System and developer messages collapse into `instructions`; everything
  /// else becomes an `input` item.
  public static func responsesArgs(_ agent: Agent, messages: [Message]) throws -> [String: Any] {
    var systemParts: [String] = []
    var input: [Any] = []

    for message in messages {
      let role = message.role.rawValue
      if role == "system" || role == "developer" {
        systemParts.append(message.textContent)
      } else {
        input.append(responsesInput(message))
      }
    }

    var args: [String: Any] = [
      "model": agent.modelId.isEmpty ? "gpt-4o" : agent.modelId,
      "input": input,
    ]
    if !systemParts.isEmpty {
      args["instructions"] = systemParts.joined(separator: "\n\n")
    }

    applyOptions(&args, agent.modelOptions, provider: "responses")

    let tools = try responsesTools(agent)
    if !tools.isEmpty { args["tools"] = tools }

    if let text = try responsesTextFormat(agent) {
      args["text"] = text
    }
    return args
  }

  /// Build the request body for an embedding call.
  public static func embeddingArgs(_ agent: Agent, messages: [Message]) -> [String: Any] {
    var args: [String: Any] = [
      "model": agent.modelId.isEmpty ? "text-embedding-ada-002" : agent.modelId,
      "input": textInput(messages),
    ]
    mergeAdditionalProperties(&args, agent.modelOptions, overwrite: true)
    return args
  }

  /// Build the request body for an image generation call.
  public static func imageArgs(_ agent: Agent, messages: [Message]) -> [String: Any] {
    let prompt: String
    switch textInput(messages) {
    case let single as String: prompt = single
    case let many as [String]: prompt = many.joined(separator: " ")
    default: prompt = ""
    }

    var args: [String: Any] = [
      "model": agent.modelId.isEmpty ? "dall-e-3" : agent.modelId,
      "prompt": prompt,
    ]
    mergeAdditionalProperties(&args, agent.modelOptions, overwrite: true)
    return args
  }

  /// Turn on server-sent streaming for a request body.
  ///
  /// `chat` and `agent` calls also request usage on the terminal event so every
  /// OpenAI-wire provider reports identical token counts.
  public static func enableStreaming(_ body: inout [String: Any], apiType: String) {
    body["stream"] = true
    if apiType == "chat" || apiType == "agent" {
      body["stream_options"] = ["include_usage": true]
    }
  }

  // MARK: - Options

  static func applyOptions(
    _ args: inout [String: Any], _ options: ModelOptions?, provider: String
  ) {
    guard let options else { return }

    if let wire = try? options.toWire(provider) {
      for (key, value) in wire where !(value is NSNull) {
        args[key] = fixFloat(value)
      }
    }
    mergeAdditionalProperties(&args, options, overwrite: false)
  }

  static func mergeAdditionalProperties(
    _ args: inout [String: Any], _ options: ModelOptions?, overwrite: Bool
  ) {
    guard let extras = options?.additionalProperties else { return }
    for (key, value) in extras where overwrite || args[key] == nil {
      args[key] = value
    }
  }

  /// `ModelOptions` stores fractional values as `Float`. Widening a `Float` to
  /// `Double` for JSON serialization exposes binary artifacts (0.1 becomes
  /// 0.10000000149011612), so round-trip through the shortest `Float` literal.
  static func fixFloat(_ value: Any) -> Any {
    guard let float = value as? Float else { return value }
    return Double(String(float)) ?? Double(float)
  }

  // MARK: - Tools

  /// Project every function tool onto the Chat Completions tool shape.
  public static func tools(_ agent: Agent) throws -> [[String: Any]] {
    try (agent.tools ?? [])
      .filter { $0.kindName == "function" }
      .map(functionTool)
  }

  static func functionTool(_ tool: Tool) throws -> [String: Any] {
    var definition: [String: Any] = ["name": tool.name]
    if let description = tool.toolDescription { definition["description"] = description }

    let bound = tool.boundParameterNames
    let visible = tool.functionParameters.filter { !bound.contains($0.name) }
    let strict = tool.isStrict

    var parameters = try JSONSchema.parameters(visible, strict: strict)
    if strict {
      parameters["additionalProperties"] = false
      definition["strict"] = true
    }
    definition["parameters"] = parameters

    return ["type": "function", "function": definition]
  }

  /// Project every function tool onto the Responses API's flat tool shape.
  public static func responsesTools(_ agent: Agent) throws -> [[String: Any]] {
    try (agent.tools ?? [])
      .filter { $0.kindName == "function" }
      .map(responsesFunctionTool)
  }

  static func responsesFunctionTool(_ tool: Tool) throws -> [String: Any] {
    var wire: [String: Any] = ["type": "function", "name": tool.name]
    if let description = tool.toolDescription { wire["description"] = description }

    let bound = tool.boundParameterNames
    let visible = tool.functionParameters.filter { !bound.contains($0.name) }
    let strict = tool.isStrict

    var parameters = try JSONSchema.parameters(visible, strict: strict)
    if strict {
      parameters["additionalProperties"] = false
      wire["strict"] = true
    }
    wire["parameters"] = parameters

    return wire
  }

  // MARK: - Structured output

  static func responseFormat(_ agent: Agent) throws -> [String: Any]? {
    guard let schema = try Structured.outputSchema(agent) else { return nil }
    return [
      "type": "json_schema",
      "json_schema": [
        "name": "structured_output",
        "strict": true,
        "schema": schema,
      ],
    ]
  }

  static func responsesTextFormat(_ agent: Agent) throws -> [String: Any]? {
    guard let schema = try Structured.outputSchema(agent) else { return nil }
    return [
      "format": [
        "type": "json_schema",
        "name": "structured_output",
        "schema": schema,
        "strict": true,
      ]
    ]
  }

  // MARK: - Agent loop

  /// Format tool results back into conversation messages.
  ///
  /// Produces one assistant message carrying `tool_calls` metadata, then one
  /// `tool` message per result.
  public static func toolMessages(_ calls: [ToolCall], results: [String]) -> [Message] {
    var messages: [Message] = []

    let wireCalls: [Any] = calls.map { call in
      [
        "id": call.id,
        "type": "function",
        "function": ["name": call.name, "arguments": call.arguments],
      ]
    }

    var assistant = Message.withText(.assistant, "")
    assistant.metadata = ["tool_calls": wireCalls]
    messages.append(assistant)

    for (call, result) in zip(calls, results) {
      var message = Message.toolResult(toolCallId: call.id, result: result)
      var metadata = message.metadata
      metadata["name"] = call.name
      message.metadata = metadata
      messages.append(message)
    }
    return messages
  }

  /// Whether a durable message carries a provider-owned Responses function-call
  /// item. Native `previous_response_id` continuation already owns that item.
  public static func isResponsesFunctionCall(_ message: Message) -> Bool {
    message.metadata["responses_function_call"] != nil
  }

  static func responsesInput(_ message: Message) -> Any {
    if let passthrough = message.metadata["responses_function_call"] {
      return passthrough
    }

    let content: Any = message.plainTextWireContent ?? message.parts.map(part)

    if let callId = message.metadata["tool_call_id"] {
      let output: String
      if let text = content as? String {
        output = text
      } else {
        output = JSONSupport.toJSON(content)
      }
      return ["type": "function_call_output", "call_id": callId, "output": output]
    }

    let role = message.role == .tool ? "user" : message.role.rawValue
    return ["role": role, "content": content]
  }

  // MARK: - Helpers

  static func textInput(_ messages: [Message]) -> Any {
    let texts = messages.map(\.textContent).filter { !$0.isEmpty }
    return texts.count == 1 ? texts[0] : texts
  }
}

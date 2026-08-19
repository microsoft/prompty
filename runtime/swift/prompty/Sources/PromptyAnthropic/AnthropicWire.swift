import Foundation

/// Wire-format projection for the Anthropic Messages API.
///
/// Every function here mirrors the Rust reference implementation
/// (`runtime/rust/prompty-anthropic/src/wire.rs`) so all runtimes produce
/// identical request bodies for the shared `spec/vectors/wire` contract.
import Prompty

import PromptyModel

public enum AnthropicWire {

  /// Anthropic requires `max_tokens`; default when the prompt omits it.
  public static let defaultMaxTokens = 4096

  /// The `anthropic-version` header value every request must carry.
  public static let anthropicVersion = "2023-06-01"

  // MARK: - Request body

  /// Build the request body for a Messages API call.
  ///
  /// System and developer messages collapse into a top-level `system` string;
  /// every other message becomes a typed content-block array.
  public static func chatArgs(_ agent: Agent, messages: [Message]) throws -> [String: Any] {
    var body: [String: Any] = ["model": agent.modelId]

    let system = extractSystem(messages)
    if !system.isEmpty { body["system"] = system }

    body["messages"] =
      messages
      .filter { $0.role != .system && $0.role != .developer }
      .map(message)

    applyOptions(&body, agent.modelOptions)

    let tools = try (agent.tools ?? []).map(tool)
    if !tools.isEmpty { body["tools"] = tools }

    if let outputConfig = try outputConfig(agent) {
      body["output_config"] = outputConfig
    }
    return body
  }

  // MARK: - System extraction

  /// Join every system/developer message's text with `\n\n`.
  static func extractSystem(_ messages: [Message]) -> String {
    messages
      .filter { $0.role == .system || $0.role == .developer }
      .map(\.textContent)
      .filter { !$0.isEmpty }
      .joined(separator: "\n\n")
  }

  // MARK: - Messages

  /// Project a message onto the Anthropic wire shape. Content is always a
  /// typed block array.
  public static func message(_ message: Message) -> [String: Any] {
    let role = (message.role == .assistant) ? "assistant" : "user"

    // Batched tool results (from the agent loop) pass through verbatim.
    if let results = message.metadata["tool_results"] {
      return ["role": role, "content": results]
    }

    // A single tool result becomes one `tool_result` block.
    if let toolUseId = message.metadata["tool_use_id"] as? String {
      return [
        "role": role,
        "content": [
          [
            "type": "tool_result",
            "tool_use_id": toolUseId,
            "content": message.textContent,
          ]
        ],
      ]
    }

    // Raw assistant content blocks preserved from a prior response.
    if let raw = message.metadata["content"] {
      return ["role": role, "content": raw]
    }

    return ["role": role, "content": message.parts.map(part)]
  }

  /// Project a single content part onto its typed wire block.
  public static func part(_ part: ContentPart) -> [String: Any] {
    switch part {
    case .textPart(let text):
      return ["type": "text", "text": text.value]

    case .imagePart(let image):
      if image.source.hasPrefix("http://") || image.source.hasPrefix("https://") {
        return ["type": "image", "source": ["type": "url", "url": image.source]]
      }
      return [
        "type": "image",
        "source": [
          "type": "base64",
          "media_type": image.mediaType ?? "image/png",
          "data": image.source,
        ],
      ]

    case .audioPart:
      return ["type": "text", "text": "[audio content not supported by Anthropic]"]

    case .filePart:
      return ["type": "text", "text": "[file content not supported by Anthropic]"]
    }
  }

  // MARK: - Options

  static func applyOptions(_ body: inout [String: Any], _ options: ModelOptions?) {
    var maxTokens = defaultMaxTokens

    if let options {
      if let wire = try? options.toWire("anthropic") {
        for (key, value) in wire where !(value is NSNull) {
          if key == "max_tokens" {
            maxTokens = intValue(value) ?? defaultMaxTokens
          } else {
            body[key] = fixFloat(value)
          }
        }
      }
      if let extras = options.additionalProperties {
        for (key, value) in extras where body[key] == nil {
          body[key] = value
        }
      }
    }

    // `max_tokens` is always required by the Anthropic API.
    body["max_tokens"] = maxTokens
  }

  static func intValue(_ value: Any) -> Int? {
    switch value {
    case let int as Int: return int
    case let int as Int32: return Int(int)
    case let double as Double: return Int(double)
    case let float as Float: return Int(float)
    case let number as NSNumber: return number.intValue
    default: return nil
    }
  }

  /// `ModelOptions` stores fractional values as `Float`; round-trip through the
  /// shortest `Float` literal so JSON serialization avoids binary artifacts.
  static func fixFloat(_ value: Any) -> Any {
    guard let float = value as? Float else { return value }
    return Double(String(float)) ?? Double(float)
  }

  // MARK: - Tools

  static func tool(_ tool: Tool) throws -> [String: Any] {
    var wire: [String: Any] = ["name": tool.name]
    if let description = tool.toolDescription { wire["description"] = description }

    if tool.kindName == "function" {
      let bound = tool.boundParameterNames
      let visible = tool.functionParameters.filter { !bound.contains($0.name) }
      wire["input_schema"] = try JSONSchema.parameters(visible, strict: false)
    } else {
      wire["input_schema"] = ["type": "object", "properties": [String: Any]()]
    }
    return wire
  }

  // MARK: - Structured output

  static func outputConfig(_ agent: Agent) throws -> [String: Any]? {
    guard let schema = try Structured.outputSchema(agent) else { return nil }
    return ["format": ["type": "json_schema", "schema": schema]]
  }

  // MARK: - Agent loop

  /// Format tool results back into conversation messages.
  ///
  /// Produces one assistant message carrying the response's original content
  /// blocks, then one user message batching every `tool_result` block.
  public static func toolMessages(
    rawResponse: Any, calls: [ToolCall], results: [String]
  ) -> [Message] {
    var messages: [Message] = []

    let contentBlocks = (rawResponse as? [String: Any])?["content"] ?? [Any]()
    var assistant = Message.withText(.assistant, "")
    assistant.metadata = ["content": contentBlocks]
    messages.append(assistant)

    let resultBlocks: [Any] = zip(calls, results).map { call, result in
      [
        "type": "tool_result",
        "tool_use_id": call.id,
        "content": result,
      ]
    }
    var user = Message.withText(.user, "")
    user.metadata = ["tool_results": resultBlocks]
    messages.append(user)

    return messages
  }
}

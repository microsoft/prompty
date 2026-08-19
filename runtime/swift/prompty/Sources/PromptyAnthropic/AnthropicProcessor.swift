import Foundation

/// Normalizes Anthropic Messages API responses into runtime values.
///
/// Behaviour is pinned by `spec/vectors/process/process_vectors.json` and
/// mirrors the Rust reference (`runtime/rust/prompty-anthropic/src/processor.rs`).
import Prompty

import PromptyModel

public struct AnthropicProcessor: Processor {
  public init() {}

  public func process(agent: Agent, response: Any) async throws -> Any {
    try AnthropicProcessor.processResponse(agent, response: response)
  }

  public func processStream(stream: Any) async throws -> Any {
    throw InvokerError.execution("Anthropic stream processing is not implemented")
  }

  /// Project a raw Anthropic response onto a runtime value.
  ///
  /// - `tool_use` blocks become `[[String: Any]]` of `{ id, name, arguments }`
  ///   and take priority over any text.
  /// - Otherwise every `text` block is concatenated into a `String`.
  /// - When the prompt declares outputs, that text is JSON-parsed; unparseable
  ///   text falls back to the raw string rather than failing the call.
  public static func processResponse(_ agent: Agent, response: Any) throws -> Any {
    guard let body = response as? [String: Any],
      let content = body["content"] as? [Any]
    else {
      return ""
    }

    let blocks = content.compactMap { $0 as? [String: Any] }

    let toolCalls: [[String: Any]] = blocks.compactMap { block in
      guard block["type"] as? String == "tool_use" else { return nil }
      return [
        "id": block["id"] as? String ?? "",
        "name": block["name"] as? String ?? "",
        "arguments": JSONSupport.toJSON(block["input"] ?? [String: Any]()),
      ]
    }
    if !toolCalls.isEmpty { return toolCalls }

    let text =
      blocks
      .compactMap { block -> String? in
        guard block["type"] as? String == "text" else { return nil }
        return block["text"] as? String
      }
      .joined()

    return finalize(agent, text: text)
  }

  private static func finalize(_ agent: Agent, text: String) -> Any {
    guard agent.hasStructuredOutputs, !text.isEmpty else { return text }
    guard let parsed = JSONSupport.parse(json: text),
      parsed is [String: Any] || parsed is [Any]
    else {
      return text
    }
    return parsed
  }
}

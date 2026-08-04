import Foundation

/// Assembles streamed OpenAI events into generated `StreamChunk` values.
///
/// Text deltas are emitted as they arrive; tool calls arrive in fragments and
/// are only emitted once the stream ends, because a call's arguments are split
/// across many events. Usage totals are emitted last when the provider reports
/// them.
import Prompty

import PromptyModel

struct StreamAccumulator {
  private var calls: [Int: ToolCall] = [:]
  private var usage: [String: Any]?

  /// Fold one streamed event into the accumulator, emitting any chunks it
  /// completes.
  mutating func consume(_ event: [String: Any]) -> [StreamChunk] {
    // Responses API events carry their delta at the top level.
    if let type = event["type"] as? String {
      return consumeResponsesEvent(type: type, event: event)
    }

    if let reported = event["usage"] as? [String: Any] { usage = reported }

    guard let choices = event["choices"] as? [Any],
      let choice = choices.first as? [String: Any],
      let delta = choice["delta"] as? [String: Any]
    else { return [] }

    var chunks: [StreamChunk] = []
    if let piece = delta["content"] as? String, !piece.isEmpty {
      chunks.append(.text(piece))
    }
    if let thinking = delta["reasoning_content"] as? String, !thinking.isEmpty {
      chunks.append(.thinkingChunk(ThinkingChunk(value: thinking)))
    }

    for entry in delta["tool_calls"] as? [Any] ?? [] {
      guard let call = entry as? [String: Any] else { continue }
      let index = (call["index"] as? Int) ?? 0
      var current = calls[index] ?? ToolCall()
      if let id = call["id"] as? String, !id.isEmpty { current.id = id }
      if let function = call["function"] as? [String: Any] {
        if let name = function["name"] as? String, !name.isEmpty { current.name = name }
        if let arguments = function["arguments"] as? String { current.arguments += arguments }
      }
      calls[index] = current
    }
    return chunks
  }

  private mutating func consumeResponsesEvent(type: String, event: [String: Any])
    -> [StreamChunk]
  {
    switch type {
    case "response.output_text.delta":
      guard let piece = event["delta"] as? String, !piece.isEmpty else { return [] }
      return [.text(piece)]

    case "response.reasoning_summary_text.delta":
      guard let piece = event["delta"] as? String, !piece.isEmpty else { return [] }
      return [.thinkingChunk(ThinkingChunk(value: piece))]

    case "response.output_item.done":
      guard let item = event["item"] as? [String: Any],
        item["type"] as? String == "function_call"
      else { return [] }
      calls[calls.count] = ToolCall(
        id: item["call_id"] as? String ?? "",
        name: item["name"] as? String ?? "",
        arguments: item["arguments"] as? String ?? ""
      )
      return []

    case "response.completed":
      if let response = event["response"] as? [String: Any],
        let reported = response["usage"] as? [String: Any]
      {
        usage = reported
      }
      return []

    case "error":
      let message = (event["message"] as? String) ?? "stream error"
      return [.errorChunk(ErrorChunk(message: message))]

    default:
      return []
    }
  }

  /// The chunks that can only be emitted once the stream is exhausted.
  func finish() -> [StreamChunk] {
    var chunks = calls.keys.sorted().map { StreamChunk.tool(calls[$0]!) }

    if let usage, let parsed = try? InvocationUsage.load(usage) {
      chunks.append(.usageChunk(UsageChunk(usage: parsed)))
    }
    return chunks
  }
}

import Foundation

/// Normalizes OpenAI responses into runtime values.
///
/// The response shape alone determines the projection, so one processor serves
/// the Chat Completions, Responses, embedding, and image APIs. Behaviour is
/// pinned by `spec/vectors/process/process_vectors.json`.
import Prompty

import PromptyModel

public struct OpenAIProcessor: Processor {
  public init() {}

  public func process(agent: Agent, response: Any) async throws -> Any {
    try OpenAIProcessor.processResponse(agent, response: response)
  }

  /// Decode a ``RawChunkStream`` of provider events into generated
  /// `StreamChunk` values.
  public func processStream(stream: Any) async throws -> Any {
    guard let raw = stream as? RawChunkStream else {
      throw InvokerError.execution("expected a raw provider chunk stream")
    }

    let decoded: ChunkStream = AsyncThrowingStream { continuation in
      Task {
        var accumulator = StreamAccumulator()
        do {
          for try await event in raw {
            for chunk in accumulator.consume(event) {
              continuation.yield(chunk)
            }
          }
          for chunk in accumulator.finish() {
            continuation.yield(chunk)
          }
          continuation.finish()
        } catch {
          continuation.yield(.errorChunk(ErrorChunk(message: "\(error)")))
          continuation.finish(throwing: error)
        }
      }
    }
    return decoded
  }

  /// Project a raw provider response onto a runtime value.
  ///
  /// - Text responses become a `String`.
  /// - Tool calls become `[[String: Any]]` of `{ id, name, arguments }`.
  /// - Embeddings become a vector, or a list of vectors for batches.
  /// - Images become the URL or base64 payload.
  /// - When the prompt declares outputs, text is JSON-parsed; unparseable text
  ///   falls back to the raw string rather than failing the call.
  public static func processResponse(_ agent: Agent, response: Any) throws -> Any {
    guard let body = response as? [String: Any] else {
      return response
    }

    if let choices = body["choices"] as? [Any] {
      return try processChat(agent, choices: choices)
    }
    if body["output"] != nil || body["output_text"] != nil {
      return try processResponses(agent, body: body)
    }
    if let data = body["data"] as? [Any] {
      return try processData(data)
    }
    return body
  }

  // MARK: - Chat Completions

  private static func processChat(_ agent: Agent, choices: [Any]) throws -> Any {
    guard let first = choices.first as? [String: Any],
      let message = first["message"] as? [String: Any]
    else {
      return ""
    }

    if let calls = message["tool_calls"] as? [Any], !calls.isEmpty {
      return calls.compactMap { entry -> [String: Any]? in
        guard let call = entry as? [String: Any] else { return nil }
        let function = call["function"] as? [String: Any] ?? [:]
        return [
          "id": call["id"] as? String ?? "",
          "name": function["name"] as? String ?? "",
          "arguments": function["arguments"] as? String ?? "",
        ]
      }
    }

    if let refusal = message["refusal"] as? String, !refusal.isEmpty {
      return refusal
    }

    let content = message["content"] as? String ?? ""
    return finalize(agent, text: content)
  }

  // MARK: - Responses API

  private static func processResponses(_ agent: Agent, body: [String: Any]) throws -> Any {
    let output = body["output"] as? [Any] ?? []

    let calls: [[String: Any]] = output.compactMap { entry in
      guard let item = entry as? [String: Any], item["type"] as? String == "function_call" else {
        return nil
      }
      return [
        "id": item["call_id"] as? String ?? item["id"] as? String ?? "",
        "name": item["name"] as? String ?? "",
        "arguments": item["arguments"] as? String ?? "",
      ]
    }
    if !calls.isEmpty { return calls }

    if let text = body["output_text"] as? String, !text.isEmpty {
      return finalize(agent, text: text)
    }

    // Fall back to assembling `output_text` blocks when the convenience field
    // is absent — some SDK shapes only carry the structured output items.
    var assembled = ""
    for entry in output {
      guard let item = entry as? [String: Any],
        let content = item["content"] as? [Any]
      else { continue }
      for block in content {
        guard let part = block as? [String: Any],
          part["type"] as? String == "output_text",
          let text = part["text"] as? String
        else { continue }
        assembled += text
      }
    }
    return finalize(agent, text: assembled)
  }

  // MARK: - Embeddings and images

  private static func processData(_ data: [Any]) throws -> Any {
    let entries = data.compactMap { $0 as? [String: Any] }

    if entries.allSatisfy({ $0["embedding"] != nil }) && !entries.isEmpty {
      let vectors = entries.map { $0["embedding"] ?? [] }
      return vectors.count == 1 ? vectors[0] : vectors
    }

    let images: [Any] = entries.compactMap { entry in
      if let url = entry["url"] as? String { return url }
      if let b64 = entry["b64_json"] as? String { return b64 }
      return nil
    }
    if images.isEmpty { return "" }
    return images.count == 1 ? images[0] : images
  }

  // MARK: - Structured output

  private static func finalize(_ agent: Agent, text: String) -> Any {
    guard agent.hasStructuredOutputs, !text.isEmpty else { return text }
    guard let parsed = JSONSupport.parse(json: text),
      parsed is [String: Any] || parsed is [Any]
    else {
      // A model that ignored the schema still returned something useful.
      return text
    }
    return parsed
  }
}

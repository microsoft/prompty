import Foundation

import PromptyModel

import XCTest

@testable import Prompty

/// Conformance against `spec/vectors/wire/wire_vectors.json`.
///
/// Builds a real agent from each vector's input and drives the real request
/// builders, so the assertion covers `ModelOptions.toWire`, tool projection and
/// structured-output wiring rather than a test-local approximation.
@testable import PromptyOpenAI

final class WireVectorTests: XCTestCase {

  func testWireVectors() throws {
    var run = VectorRun(stage: "wire")

    for vector in try Spec.vectors("wire") {
      let name = vector["name"] as? String ?? "<unnamed>"
      run.started()
      let input = vector["input"] as? [String: Any] ?? [:]
      let expected = vector["expected"] as? [String: Any] ?? [:]

      // This harness covers the OpenAI provider; Anthropic vectors belong to
      // that provider's own package.
      guard (input["provider"] as? String ?? "openai") == "openai" else { continue }

      do {
        let agent = try Self.agent(from: input)
        let messages = try Self.messages(from: input)
        let apiType = input["apiType"] as? String ?? "chat"

        var body: [String: Any]
        switch apiType {
        case "chat", "agent":
          body = try OpenAIWire.chatArgs(agent, messages: messages)
        case "responses":
          body = try OpenAIWire.responsesArgs(agent, messages: messages)
        case "embedding":
          body = OpenAIWire.embeddingArgs(agent, messages: messages)
        case "image":
          body = OpenAIWire.imageArgs(agent, messages: messages)
        default:
          throw InvokerError.execution("Unsupported apiType: \(apiType)")
        }

        if input["stream"] as? Bool == true {
          OpenAIWire.enableStreaming(&body, apiType: apiType)
        }

        guard let expectedBody = expected["request_body"] else { continue }
        try expectEqual(body, expectedBody, "request_body")
      } catch {
        run.fail(name, "\(error)")
      }
    }

    run.assertClean()
  }

  // MARK: - Vector input decoding

  private static func agent(from input: [String: Any]) throws -> Agent {
    var model: [String: Any] = [
      "provider": input["provider"] as? String ?? "openai"
    ]
    if let id = input["model_id"] as? String { model["id"] = id }
    if let apiType = input["apiType"] as? String { model["apiType"] = apiType }
    if let options = input["options"] as? [String: Any], !options.isEmpty {
      model["options"] = options
    }

    var data: [String: Any] = [
      "kind": "prompt",
      "name": "wire-vectors",
      "model": model,
    ]
    if let tools = input["tools"] as? [Any], !tools.isEmpty { data["tools"] = tools }
    if let outputs = input["outputs"] as? [Any], !outputs.isEmpty { data["outputs"] = outputs }

    return try Agent.load(data)
  }

  private static func messages(from input: [String: Any]) throws -> [Message] {
    let raw = input["messages"] as? [[String: Any]] ?? []
    return try raw.map { entry in
      var message = Message()
      message.role = try Role.parse(entry["role"] as? String ?? "user")
      message.parts = try (entry["content"] as? [[String: Any]] ?? []).map(part)

      // Vectors carry provider passthrough (e.g. tool_call_id) as sibling keys.
      for (key, value) in entry where key != "role" && key != "content" {
        message.metadata[key] = value
      }
      return message
    }
  }

  /// Vectors express every part's payload as `value` (plus optional
  /// `mediaType`), which does not match the model's per-kind field names, so
  /// the mapping is explicit. This mirrors the Rust vector runner.
  private static func part(_ raw: [String: Any]) throws -> ContentPart {
    let kind = raw["kind"] as? String ?? "text"
    let value = raw["value"] as? String ?? ""
    let mediaType = raw["mediaType"] as? String

    switch kind {
    case "text":
      return .textPart(TextPart(value: value))
    case "image":
      return .imagePart(
        ImagePart(source: value, detail: raw["detail"] as? String, mediaType: mediaType))
    case "audio":
      return .audioPart(AudioPart(source: value, mediaType: mediaType))
    case "file":
      return .filePart(FilePart(source: value, mediaType: mediaType))
    default:
      throw InvokerError.parse("Unknown content kind: \(kind)")
    }
  }
}

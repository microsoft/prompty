import Foundation

import PromptyModel

import XCTest

@testable import Prompty

/// Conformance against the Anthropic `wire` cases in `vectors.json`.
///
/// Builds a real agent from each vector's input and drives ``AnthropicWire`` so
/// the assertion covers `ModelOptions.toWire("anthropic")`, tool projection and
/// system extraction rather than a test-local approximation.
@testable import PromptyAnthropic

final class AnthropicWireVectorTests: XCTestCase {

  func testAnthropicWireVectors() throws {
    var run = VectorRun(stage: "wire")

    for vector in try Spec.vectors("wire") {
      let name = vector["name"] as? String ?? "<unnamed>"
      let input = vector["input"] as? [String: Any] ?? [:]
      let expected = vector["expected"] as? [String: Any] ?? [:]

      guard (input["provider"] as? String ?? "openai") == "anthropic" else { continue }
      run.started()

      do {
        let agent = try Self.agent(from: input)
        let messages = try Self.messages(from: input)
        let apiType = input["apiType"] as? String ?? "chat"

        guard apiType == "chat" || apiType == "agent" else {
          throw InvokerError.execution("Unsupported apiType: \(apiType)")
        }

        let body = try AnthropicWire.chatArgs(agent, messages: messages)

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
      "provider": input["provider"] as? String ?? "anthropic"
    ]
    if let id = input["model_id"] as? String { model["id"] = id }
    if let apiType = input["apiType"] as? String { model["apiType"] = apiType }
    if let options = input["options"] as? [String: Any], !options.isEmpty {
      model["options"] = options
    }

    var data: [String: Any] = [
      "kind": "prompt",
      "name": "anthropic-wire-vectors",
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

      for (key, value) in entry where key != "role" && key != "content" {
        message.metadata[key] = value
      }
      return message
    }
  }

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

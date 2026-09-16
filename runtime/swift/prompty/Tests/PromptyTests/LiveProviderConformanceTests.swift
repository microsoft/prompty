import Foundation

import PromptyAnthropic

import PromptyFoundry

import PromptyModel

import PromptyOpenAI

import XCTest

@testable import Prompty

final class LiveProviderConformanceTests: XCTestCase {
  private static let loaded: Bool = {
    loadLiveProviderDotEnv()
    Registry.shared.registerDefaults()
    registerOpenAI()
    registerAnthropic()
    registerFoundry()
    return true
  }()

  override func setUp() {
    super.setUp()
    _ = Self.loaded
  }

  func testLiveProviderConformanceVectors() async throws {
    let vectors = try Spec.vectors("live-provider")
    var run = VectorRun(stage: "live-provider")

    for vector in vectors {
      let name = vector["name"] as? String ?? "<unnamed>"
      guard capabilitiesAvailable(vector) else {
        run.skip()
        continue
      }
      await run.checkAsync(name) {
        let input = try resolveRefs(vector["input"])
        let observed = try await invoke(input)
        let expected = vector["expected"] as Any
        XCTAssertTrue(
          Spec.equal(project(observed, expected), expected),
          "[\(name)] expected \(Spec.describe(expected)), got \(Spec.describe(observed))")
      }
    }

    run.assertClean()
  }

  private func invoke(_ input: [String: Any]) async throws -> [String: Any] {
    let provider = (input["provider"] as? String ?? "openai").lowercased()
    let agent = try liveAgent(input, provider: provider)
    let messages = liveMessages(input)
    let executor = try Registry.shared.executor(for: provider)
    let processor = try Registry.shared.processor(for: provider)
    let raw = try await executor.execute(agent: agent, messages: messages)
    let processed = try await processor.process(agent: agent, response: raw)
    return [
      "accepted": true,
      "contentNonEmpty": !String(describing: processed).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
    ]
  }

  private func liveAgent(_ input: [String: Any], provider: String) throws -> Agent {
    var model: [String: Any] = [
      "id": input["model"] as? String ?? "",
      "provider": provider,
      "apiType": input["apiType"] as? String ?? "chat",
      "options": input["options"] as? [String: Any] ?? [:],
    ]

    if provider == "foundry" || provider == "azure" {
      if let apiKey = input["apiKey"] as? String, !apiKey.isEmpty {
        model["connection"] = [
          "kind": "key",
          "endpoint": input["endpoint"] as? String ?? "",
          "apiKey": apiKey,
        ]
      } else {
        model["connection"] = [
          "kind": "foundry",
          "endpoint": input["endpoint"] as? String ?? "",
        ]
      }
    }

    return try Agent.load([
      "kind": "prompt",
      "name": "swift-live-provider-vector",
      "model": model,
    ])
  }

  private func liveMessages(_ input: [String: Any]) -> [Message] {
    let raw = input["messages"] as? [[String: Any]] ?? []
    return raw.map { item in
      Message(
        role: Role(rawValue: item["role"] as? String ?? "user") ?? .user,
        parts: [.textPart(TextPart(value: item["content"] as? String ?? ""))]
      )
    }
  }

  private func capabilitiesAvailable(_ vector: [String: Any]) -> Bool {
    for requirement in vector["requires"] as? [String] ?? [] {
      switch requirement {
      case "provider:openai":
        if !envPresent("OPENAI_API_KEY") { return false }
      case "provider:anthropic":
        if !envPresent("ANTHROPIC_API_KEY") { return false }
      case "provider:foundry-key":
        if !envPresent(
          "AZURE_OPENAI_ENDPOINT",
          "AZURE_OPENAI_API_KEY",
          "AZURE_OPENAI_CHAT_DEPLOYMENT"
        ) { return false }
      case "provider:foundry-entra":
        if !envPresent(
          "FOUNDRY_PROJECT_ENDPOINT",
          "FOUNDRY_MODEL",
          "AZURE_OPENAI_ACCESS_TOKEN"
        ) && !envPresent(
          "FOUNDRY_PROJECT_ENDPOINT",
          "FOUNDRY_MODEL",
          "AZURE_INFERENCE_CREDENTIAL"
        ) { return false }
      default:
        return false
      }
    }
    return true
  }

  private func envPresent(_ names: String...) -> Bool {
    names.allSatisfy { name in
      let value = (ProcessInfo.processInfo.environment[name] ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
      let lowered = value.lowercased()
      return !value.isEmpty
        && !lowered.hasPrefix("sk-test")
        && !lowered.hasPrefix("test")
        && !lowered.hasPrefix("dummy")
        && !lowered.hasPrefix("your_")
        && !lowered.hasPrefix("<")
    }
  }

  private func resolveRefs(_ value: Any?) throws -> [String: Any] {
    guard let object = try resolve(value) as? [String: Any] else {
      throw Spec.SpecError.malformed("live provider vector input is not an object")
    }
    return object
  }

  private func resolve(_ value: Any?) throws -> Any? {
    if let object = value as? [String: Any] {
      if let env = object["$env"] as? String {
        return ProcessInfo.processInfo.environment[env] ?? ""
      }
      var result: [String: Any] = [:]
      for (key, child) in object {
        result[key] = try resolve(child) ?? NSNull()
      }
      return result
    }
    if let array = value as? [Any] {
      return try array.map { try resolve($0) ?? NSNull() }
    }
    return value
  }

  private func project(_ observed: Any?, _ expected: Any?) -> Any? {
    if let expectedDict = expected as? [String: Any], let observedDict = observed as? [String: Any] {
      var result: [String: Any] = [:]
      for key in expectedDict.keys {
        result[key] = project(observedDict[key], expectedDict[key]) ?? NSNull()
      }
      return result
    }
    return observed
  }

  private static func loadLiveProviderDotEnv() {
    let packageRoot = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
    let candidates = [
      packageRoot.appendingPathComponent(".env"),
      packageRoot
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent(".env"),
    ]
    for url in candidates where FileManager.default.fileExists(atPath: url.path) {
      guard let contents = try? String(contentsOf: url) else { continue }
      for line in contents.split(whereSeparator: \.isNewline) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
        let parts = trimmed.split(separator: "=", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { continue }
        if ProcessInfo.processInfo.environment[parts[0]] != nil { continue }
        var value = parts[1].trimmingCharacters(in: .whitespaces)
        if (value.hasPrefix("\"") && value.hasSuffix("\""))
          || (value.hasPrefix("'") && value.hasSuffix("'"))
        {
          value = String(value.dropFirst().dropLast())
        }
        Env.set(parts[0], value)
      }
    }
  }
}

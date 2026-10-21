import Foundation
import PromptyModel
import XCTest

@testable import Prompty
@testable import PromptyAnthropic
@testable import PromptyOpenAI

/// A file-supplied `apiKey` must be the key sent, never the ambient env key
/// (`apiKey` is withheld from `save()`, so configs must read the live value).
final class ConnectionKeyTests: XCTestCase {

  private func agent(provider: String) throws -> Agent {
    try Agent.load([
      "kind": "prompt",
      "name": "connection-key",
      "model": [
        "id": "m",
        "provider": provider,
        "connection": [
          "kind": "key",
          "endpoint": "https://custom.example.com",
          "apiKey": "file-key",
        ],
      ],
    ])
  }

  private var savedEnv: [String: String?] = [:]

  override func setUp() {
    for key in ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] {
      savedEnv[key] = ProcessInfo.processInfo.environment[key]
      Env.set(key, "ambient-key")
    }
  }

  override func tearDown() {
    for (key, value) in savedEnv { Env.set(key, value) }
  }

  func testAnthropicUsesFileKey() throws {
    XCTAssertEqual(try AnthropicConfig.resolve(agent(provider: "anthropic")).apiKey, "file-key")
  }

  func testOpenAIUsesFileKey() throws {
    XCTAssertEqual(try OpenAIConfig.resolve(agent(provider: "openai")).apiKey, "file-key")
  }
}

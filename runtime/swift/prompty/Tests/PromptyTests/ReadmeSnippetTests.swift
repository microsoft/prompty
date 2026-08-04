import Foundation

import Prompty

import PromptyModel

import PromptyOpenAI

/// Compiles the snippets in `runtime/swift/README.md`.
///
/// The README claimed a `Prompty.load(path:)` entry point that never existed.
/// Documented calls are API surface, so they are type-checked here rather than
/// trusted. Nothing is executed — a compile is the whole assertion.
import XCTest

final class ReadmeSnippetTests: XCTestCase {

  func testReadmeSnippetsCompile() throws {
    func quickStart() async throws -> Any? {
      Registry.shared.registerDefaults()
      registerOpenAI()

      return try await Pipeline.invoke(
        path: "basic.prompty",
        inputs: ["question": "What is the capital of Iceland?"]
      )
    }

    func stages(inputs: [String: Any]) async throws -> Any? {
      let agent = try Loader.load(path: "basic.prompty")
      let messages = try await Pipeline.prepare(agent, inputs: inputs)
      let raw = try await Pipeline.run(agent, messages: messages)
      return raw
    }

    func toolLoop(
      agent: Prompty, raw: Any?, inputs: [String: Any],
      myTools: [String: ([String: Any]) throws -> String]
    ) throws -> [String] {
      var results: [String] = []
      for call in Pipeline.toolCalls(in: raw) {
        let args = Pipeline.boundArguments(agent, call: call, inputs: inputs)
        let result = try myTools[call.name]!(args)
        results.append(result)
      }
      return results
    }

    XCTAssertNotNil(quickStart)
    XCTAssertNotNil(stages)
    XCTAssertNotNil(toolLoop)
  }
}

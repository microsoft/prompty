import Foundation

import PromptyModel

import PromptyOpenAI

import XCTest

/// End-to-end tests against the real OpenAI API.
///
/// These are the only tests that leave the machine. They skip themselves when
/// `OPENAI_API_KEY` is absent, so a checkout without credentials still runs a
/// full green suite. Credentials come from a `.env` beside the package, which
/// is ignored by git and never committed.
///
/// The runtime itself never reads `.env` — populating the environment is the
/// host's job, so the loading below belongs to the test, not the library.
@testable import Prompty

// MARK: - .env loading

/// Load `KEY=VALUE` lines from a `.env` beside the package into the process
/// environment, without overwriting values that are already set.
final class LiveOpenAITests: XCTestCase {

  private static let loaded: Bool = {
    loadDotEnv()
    Registry.shared.registerDefaults()
    registerOpenAI()
    return true
  }()

  override func setUp() {
    super.setUp()
    _ = Self.loaded
  }

  /// Skip rather than fail when the environment has no credentials.
  private func requireCredentials() throws -> String {
    let key = ProcessInfo.processInfo.environment["OPENAI_API_KEY"] ?? ""
    try XCTSkipIf(key.isEmpty, "OPENAI_API_KEY not set — skipping live OpenAI tests")
    return key
  }

  private var modelId: String {
    let configured = ProcessInfo.processInfo.environment["OPENAI_MODEL"] ?? ""
    return configured.isEmpty ? "gpt-4o-mini" : configured
  }

  // MARK: - Chat

  /// The whole pipeline against a real endpoint: load, render, parse, execute,
  /// process.
  func testLiveChatCompletion() async throws {
    _ = try requireCredentials()

    let agent = try Agent.load([
      "kind": "prompt",
      "name": "live-chat",
      "model": ["id": modelId, "provider": "openai", "apiType": "chat"],
      "inputs": [["name": "topic", "kind": "string"]],
      "instructions":
        "system:\nAnswer with a single word and no punctuation.\n\nuser:\nWhat colour is a {{topic}}?",
    ])

    let result = try await Pipeline.invoke(agent, inputs: ["topic": "banana"])
    let text = try XCTUnwrap(
      result as? String, "expected text content, got \(String(describing: result))")

    XCTAssertFalse(text.isEmpty)
    XCTAssertTrue(
      text.lowercased().contains("yellow"),
      "expected the model to answer 'yellow', got \(text.debugDescription)")
  }

  /// Model options must actually reach the provider.
  ///
  /// Asserted relatively: the same prompt is run twice, once capped and once
  /// with room to answer. An absolute check on the capped reply alone would
  /// also pass if the model simply happened to be terse.
  func testLiveChatHonoursMaxOutputTokens() async throws {
    _ = try requireCredentials()

    func answer(maxOutputTokens: Int) async throws -> String {
      let agent = try Agent.load([
        "kind": "prompt",
        "name": "live-capped",
        "model": [
          "id": modelId, "provider": "openai", "apiType": "chat",
          "options": ["temperature": 0, "maxOutputTokens": maxOutputTokens],
        ],
        "instructions": "user:\nCount slowly from one to one hundred in words.",
      ])
      let result = try await Pipeline.invoke(agent)
      return try XCTUnwrap(result as? String)
    }

    let capped = try await answer(maxOutputTokens: 16)
    let generous = try await answer(maxOutputTokens: 800)

    XCTAssertFalse(capped.isEmpty)
    XCTAssertFalse(generous.isEmpty)
    XCTAssertGreaterThan(
      generous.count, capped.count * 3,
      "maxOutputTokens did not reach the provider — a 16-token cap and an "
        + "800-token cap produced comparable output: "
        + "capped=\(capped.count) generous=\(generous.count)")
  }

  // MARK: - Streaming

  /// Streaming has to deliver the answer as a sequence of events, not one blob.
  ///
  /// This asserts on decoded SSE events rather than on wire timing. On Windows
  /// `URLSession.bytes(for:)` is unavailable, so the provider buffers the
  /// response and then decodes it; requiring many events still proves the SSE
  /// framing and chunk accumulation are right, which is the part this runtime
  /// owns.
  func testLiveStreaming() async throws {
    _ = try requireCredentials()

    let agent = try Agent.load([
      "kind": "prompt",
      "name": "live-stream",
      "model": [
        "id": modelId, "provider": "openai", "apiType": "chat",
        "options": ["temperature": 0, "additionalProperties": ["stream": true]],
      ],
      "instructions":
        "user:\nList the numbers one through twenty in words, one per line, and nothing else.",
    ])

    let messages = try await Pipeline.prepare(agent)
    let stream = try await Pipeline.stream(agent, messages: messages)

    var chunks = 0
    var text = ""
    for try await chunk in stream {
      if case .textChunk(let part) = chunk {
        chunks += 1
        text += part.value
      }
    }

    // More than one event proves the body was decoded as a stream of SSE frames
    // rather than handed over as a single blob. The floor is deliberately loose:
    // a provider may legally coalesce deltas, so the real fidelity check is the
    // ordered content assertion below.
    XCTAssertGreaterThan(chunks, 1, "expected several streamed events, got \(chunks)")

    // Every item, in order, must survive reassembly. This is what a dropped or
    // misordered chunk would break, and unlike comparing against a second
    // request it does not assume the model is deterministic across calls.
    let words = [
      "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
      "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
      "eighteen", "nineteen", "twenty",
    ]
    let lowered = text.lowercased()
    var cursor = lowered.startIndex
    for word in words {
      guard let found = lowered.range(of: word, range: cursor..<lowered.endIndex) else {
        return XCTFail("streamed text lost \(word.debugDescription): \(text.debugDescription)")
      }
      cursor = found.upperBound
    }
  }

  /// `run` must notice the streaming option and still return a whole answer.
  func testLiveRunAccumulatesStream() async throws {
    _ = try requireCredentials()

    let agent = try Agent.load([
      "kind": "prompt",
      "name": "live-stream-run",
      "model": [
        "id": modelId, "provider": "openai", "apiType": "chat",
        "options": ["temperature": 0, "additionalProperties": ["stream": true]],
      ],
      "instructions": "user:\nReply with exactly: accumulated",
    ])

    let result = try await Pipeline.invoke(agent)
    let text = try XCTUnwrap(result as? String)
    XCTAssertTrue(
      text.lowercased().contains("accumulated"),
      "unexpected accumulated text: \(text.debugDescription)")
  }

  // MARK: - Structured output

  /// Declared outputs become a response schema the model has to satisfy.
  ///
  /// The instructions deliberately ask for prose. If the schema were not
  /// actually sent, the model would obey the prose request and the decode would
  /// fail — so a successful decode proves the schema won.
  func testLiveStructuredOutput() async throws {
    _ = try requireCredentials()

    struct City: Decodable {
      let name: String
      let country: String
      let population: Int
    }

    let agent = try Agent.load([
      "kind": "prompt",
      "name": "live-structured",
      "model": [
        "id": modelId, "provider": "openai", "apiType": "chat",
        "options": ["temperature": 0],
      ],
      "outputs": [
        ["name": "name", "kind": "string", "required": true],
        ["name": "country", "kind": "string", "required": true],
        ["name": "population", "kind": "integer", "required": true],
      ],
      "instructions":
        "user:\nDescribe the city of Reykjavik in two friendly English sentences. "
        + "Write flowing prose. Do not use JSON and do not use any braces.",
    ])

    let result = try await Pipeline.invoke(agent)
    let city = try Structured.cast(result, as: City.self)

    XCTAssertTrue(city.name.lowercased().contains("reykjav"), "unexpected name: \(city.name)")
    XCTAssertTrue(
      city.country.lowercased().contains("iceland"), "unexpected country: \(city.country)")
    XCTAssertGreaterThan(city.population, 0)
  }

  // MARK: - Tools

  /// A full tool exchange: the model asks for a tool, the host runs it, the
  /// result goes back, and the model answers using it.
  func testLiveToolCalling() async throws {
    _ = try requireCredentials()

    let agent = try Agent.load([
      "kind": "prompt",
      "name": "live-tools",
      "model": [
        "id": modelId, "provider": "openai", "apiType": "chat",
        "options": ["temperature": 0],
      ],
      "tools": [
        [
          "kind": "function",
          "name": "get_temperature",
          "description": "Look up the current temperature in a city, in celsius.",
          "parameters": [
            ["name": "city", "kind": "string", "description": "City name", "required": true]
          ],
        ]
      ],
      "instructions":
        "system:\nUse the tools you are given. Never guess a temperature. "
        + "Always quote the station code from the tool result verbatim in your answer."
        + "\n\nuser:\nWhat is the temperature in Reykjavik right now?",
    ])

    let messages = try await Pipeline.prepare(agent)
    let first = try await Pipeline.run(agent, messages: messages)

    let calls = Pipeline.toolCalls(in: first)
    XCTAssertFalse(calls.isEmpty, "the model did not request a tool: \(String(describing: first))")
    let call = try XCTUnwrap(calls.first)
    XCTAssertEqual(call.name, "get_temperature")
    XCTAssertTrue(
      call.arguments.lowercased().contains("reykjav"),
      "tool arguments lost the city: \(call.arguments)")

    // An opaque code generated at run time. The model cannot produce it by
    // guessing or from training data, so seeing it in the final answer is proof
    // the tool result was actually read. It is deliberately alphabetic: a digit
    // sentinel would overlap the temperature assertion below and make it pass
    // for the wrong reason. The temperature itself stays plausible — an absurd
    // reading makes the model report a tool failure instead.
    let letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    let station = "RVK-" + String((0..<6).map { _ in letters.randomElement()! })
    let followUp =
      messages
      + (try Pipeline.toolMessages(
        agent,
        toolCalls: calls,
        toolResults: calls.map { _ in #"{"celsius": 3, "station": "\#(station)"}"# }))

    let second = try await Pipeline.run(agent, messages: followUp)
    let answer = try XCTUnwrap(
      second as? String, "expected a final answer, got \(String(describing: second))")
    XCTAssertTrue(
      answer.contains(station),
      "the model did not use the tool result (expected \(station)): \(answer.debugDescription)")
    XCTAssertTrue(
      answer.contains("3"),
      "the tool's temperature is missing from the answer: \(answer.debugDescription)")
  }

  // MARK: - Prompts on disk

  /// The same flow starting from a real `.prompty` file, including
  /// `${env:OPENAI_API_KEY}` resolution in the connection.
  func testLivePromptFile() async throws {
    _ = try requireCredentials()

    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("prompty-live-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let file = directory.appendingPathComponent("capital.prompty")
    let contents = """
      ---
      name: live-file
      model:
        id: \(modelId)
        provider: openai
        apiType: chat
        connection:
          kind: key
          apiKey: ${env:OPENAI_API_KEY}
        options:
          temperature: 0
      inputs:
        - name: country
          kind: string
          default: Iceland
      ---
      system:
      Answer with only the city name.

      user:
      What is the capital of {{country}}?
      """
    try contents.write(to: file, atomically: true, encoding: .utf8)

    let result = try await Pipeline.invoke(path: file.path, inputs: ["country": "Iceland"])
    let text = try XCTUnwrap(result as? String)
    XCTAssertTrue(
      text.lowercased().contains("reykjav"),
      "unexpected answer: \(text.debugDescription)")
  }
}
private func loadDotEnv() {
  let packageRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()  // PromptyTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // package root

  let candidates = [
    packageRoot.appendingPathComponent(".env"),
    packageRoot.deletingLastPathComponent().appendingPathComponent(".env"),
  ]

  for url in candidates {
    guard let contents = try? String(contentsOf: url, encoding: .utf8) else { continue }
    // Split on any newline: Swift treats a CRLF pair as one grapheme, so
    // splitting on a literal "\n" silently fails on Windows-authored files.
    for line in contents.split(whereSeparator: \.isNewline) {
      let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty, !trimmed.hasPrefix("#") else { continue }
      guard let separator = trimmed.firstIndex(of: "=") else { continue }

      let key = String(trimmed[trimmed.startIndex..<separator]).trimmingCharacters(
        in: .whitespaces)
      var value = String(trimmed[trimmed.index(after: separator)...]).trimmingCharacters(
        in: .whitespaces)
      if value.count >= 2, value.hasPrefix("\""), value.hasSuffix("\"") {
        value = String(value.dropFirst().dropLast())
      }

      guard !key.isEmpty, (ProcessInfo.processInfo.environment[key] ?? "").isEmpty else { continue }
      Env.set(key, value)
    }
  }
}

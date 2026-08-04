import Foundation
import PromptyModel
import XCTest

@testable import Prompty

/// Guards for defects found in review that the spec vectors do not cover.
///
/// Each test names the behavior it protects, so a future regression reads as a
/// specific broken promise rather than an anonymous assertion failure.
final class RegressionTests: XCTestCase {

  // MARK: - Wildcard template kinds

  /// A prompt that configures only one half of `template` must still resolve
  /// the other half to its default.
  ///
  /// The generated model fills an unset `kind` with the schema wildcard `"*"`,
  /// which is never a registry key. Treating it as a real key made a prompt
  /// that set only `format` fail to find a parser.
  func testPartialTemplateFallsBackToDefaults() throws {
    let formatOnly = try Prompty.load([
      "kind": "prompt",
      "name": "format-only",
      "template": ["format": ["kind": "mustache"]],
    ])
    XCTAssertEqual(formatOnly.formatKind, "mustache")
    XCTAssertEqual(formatOnly.parserKind, Defaults.parser)

    let parserOnly = try Prompty.load([
      "kind": "prompt",
      "name": "parser-only",
      "template": ["parser": ["kind": "prompty"]],
    ])
    XCTAssertEqual(parserOnly.formatKind, Defaults.templateFormat)
    XCTAssertEqual(parserOnly.parserKind, "prompty")

    let noTemplate = try Prompty.load(["kind": "prompt", "name": "bare"])
    XCTAssertEqual(noTemplate.formatKind, Defaults.templateFormat)
    XCTAssertEqual(noTemplate.parserKind, Defaults.parser)
  }

  /// An explicitly empty kind is as unset as a missing one.
  func testEmptyTemplateKindFallsBackToDefaults() throws {
    let agent = try Prompty.load([
      "kind": "prompt",
      "name": "empty-kinds",
      "template": ["format": ["kind": ""], "parser": ["kind": ""]],
    ])
    XCTAssertEqual(agent.formatKind, Defaults.templateFormat)
    XCTAssertEqual(agent.parserKind, Defaults.parser)
  }

  // MARK: - Nonce ownership

  /// `prepare` must expand a thread input into real messages.
  ///
  /// Nonce substitution has to happen exactly once. When both the pipeline and
  /// the renderer substituted, the renderer minted a second nonce, the pipeline
  /// searched the output for its own now-absent first one, and every thread,
  /// image, file, and audio input was silently dropped.
  func testPrepareExpandsThreadInputs() async throws {
    let agent = try Prompty.load([
      "kind": "prompt",
      "name": "threaded",
      "instructions": "system:\nYou are helpful.\n\n{{history}}\n\nuser:\n{{question}}",
      "inputs": [
        ["name": "history", "kind": "thread"],
        ["name": "question", "kind": "string"],
      ],
    ])

    let messages = try await Pipeline.prepare(
      agent,
      inputs: [
        "history": [
          ["role": "user", "content": "first question"],
          ["role": "assistant", "content": "first answer"],
        ],
        "question": "second question",
      ]
    )

    let roles = messages.map { $0.role.rawValue }
    XCTAssertEqual(roles, ["system", "user", "assistant", "user"])

    let texts = messages.map { Self.text($0.parts) }
    XCTAssertEqual(texts[1], "first question")
    XCTAssertEqual(texts[2], "first answer")
    XCTAssertEqual(texts[3], "second question")
  }

  /// The nonce must not survive into the messages handed to a provider.
  func testPrepareLeavesNoNonceResidue() async throws {
    let agent = try Prompty.load([
      "kind": "prompt",
      "name": "threaded-residue",
      "instructions": "system:\nBe brief.\n\n{{history}}\n\nuser:\nhi",
      "inputs": [["name": "history", "kind": "thread"]],
    ])

    let messages = try await Pipeline.prepare(
      agent,
      inputs: ["history": [["role": "user", "content": "prior"]]]
    )

    for message in messages {
      XCTAssertFalse(
        Self.text(message.parts).contains(Defaults.threadNoncePrefix),
        "a nonce marker leaked into a prepared message")
    }
  }

  /// Concatenated text of a message's parts.
  private static func text(_ parts: [ContentPart]) -> String {
    parts.compactMap { part -> String? in
      if case .textPart(let text) = part { return text.value }
      return nil
    }.joined()
  }

  // MARK: - Registry publication

  /// Concurrent first use must never observe a half-installed registry.
  ///
  /// `registerDefaults` used to set its "already done" flag and release the
  /// lock before installing the tables, so a racing caller could see the flag,
  /// skip registration, and then fail to resolve a renderer that was not there
  /// yet.
  func testConcurrentRegisterDefaultsAlwaysResolves() async throws {
    let registry = Registry()

    try await withThrowingTaskGroup(of: Void.self) { group in
      for _ in 0..<64 {
        group.addTask {
          registry.registerDefaults()
          _ = try registry.renderer(for: Defaults.templateFormat)
          _ = try registry.parser(for: Defaults.parser)
        }
      }
      try await group.waitForAll()
    }
  }

  // MARK: - Expression evaluation

  /// Jinja expressions have to be evaluated, not pattern-matched.
  ///
  /// The previous renderer recognized only a handful of shapes and resolved
  /// everything else to nothing, so a wrong condition rendered as an empty
  /// string instead of failing.
  func testRendererEvaluatesExpressions() async throws {
    let cases: [(String, [String: Any], String)] = [
      ("{% if count > 2 %}many{% else %}few{% endif %}", ["count": 5], "many"),
      ("{% if count > 2 %}many{% else %}few{% endif %}", ["count": 1], "few"),
      ("{% if a and b %}both{% endif %}", ["a": true, "b": true], "both"),
      ("{% if a and b %}both{% endif %}", ["a": true, "b": false], ""),
      ("{% if not flag %}off{% endif %}", ["flag": false], "off"),
      ("{% if 'x' in items %}found{% endif %}", ["items": ["w", "x"]], "found"),
      ("{% if 'z' in items %}found{% endif %}", ["items": ["w", "x"]], ""),
      ("{{ a + b }}", ["a": 2, "b": 3], "5"),
      ("{{ name is defined }}", ["name": "jane"], "true"),
      ("{{ missing is not defined }}", [:], "true"),
      ("{{ items[1] }}", ["items": ["a", "b", "c"]], "b"),
      ("{{ user.name }}", ["user": ["name": "jane"]], "jane"),
    ]

    var run = VectorRun(stage: "expression")
    for (template, inputs, expected) in cases {
      run.started()
      let agent = try Prompty.load([
        "kind": "prompt", "name": "expr", "instructions": template,
      ])
      do {
        let rendered = try await Pipeline.render(agent, inputs: inputs)
        if rendered != expected {
          run.fail(template, "expected \(expected.debugDescription), got \(rendered.debugDescription)")
        }
      } catch {
        run.fail(template, "\(error)")
      }
    }
    run.assertClean()
  }

  /// Syntax the runtime does not implement must be reported, not ignored.
  func testRendererRejectsUnsupportedExpressions() async throws {
    let agent = try Prompty.load([
      "kind": "prompt",
      "name": "unsupported",
      "instructions": "{{ value ** }}",
    ])

    do {
      let rendered = try await Pipeline.render(agent, inputs: ["value": 2])
      XCTFail("expected a parse failure, rendered \(rendered.debugDescription)")
    } catch {
      // Expected: an unparseable expression is an error, not an empty string.
    }
  }

  // MARK: - Strict pre-render

  /// Strict mode must refuse a pre-render result it cannot understand.
  ///
  /// Accepting it as "no context" would quietly turn strict validation off,
  /// which is the one thing strict mode is meant to guarantee.
  func testStrictModeRejectsUnknownPreRenderResult() async throws {
    let registry = Registry()
    registry.registerDefaults()
    registry.register(parser: StubParser(preRenderResult: "not a PreRenderResult"), for: "stub")

    let agent = try Prompty.load([
      "kind": "prompt",
      "name": "strict-stub",
      "instructions": "system:\nhi",
      "template": ["format": ["kind": "jinja2"], "parser": ["kind": "stub"]],
    ])

    do {
      _ = try await Pipeline.prepare(agent, inputs: [:], registry: registry)
      XCTFail("expected strict mode to reject an unsupported pre-render result")
    } catch {
      // `InvokerError` is also a generated model type, so the error is matched
      // by message rather than by a name that is ambiguous in test scope.
      XCTAssertTrue("\(error)".contains("pre-render"), "unexpected message: \(error)")
    }
  }

  /// A parser that opts out of pre-render is still valid.
  func testStrictModeAcceptsNilPreRenderResult() async throws {
    let registry = Registry()
    registry.registerDefaults()
    registry.register(parser: StubParser(preRenderResult: nil), for: "stub-nil")

    let agent = try Prompty.load([
      "kind": "prompt",
      "name": "strict-nil",
      "instructions": "system:\nhi",
      "template": ["format": ["kind": "jinja2"], "parser": ["kind": "stub-nil"]],
    ])

    let messages = try await Pipeline.prepare(agent, inputs: [:], registry: registry)
    XCTAssertEqual(messages.count, 1)
  }

  // MARK: - Structured output

  /// A provider that already returned JSON text must not be re-encoded.
  ///
  /// Serializing an existing JSON string produced a JSON string *literal*, so
  /// decoding into the declared shape failed on every structured response.
  func testStructuredCastAcceptsJSONText() throws {
    struct Answer: Decodable, Equatable {
      let city: String
      let population: Int
    }

    let decoded = try Structured.cast(
      #"{"city":"Seattle","population":749256}"#, as: Answer.self)
    XCTAssertEqual(decoded, Answer(city: "Seattle", population: 749_256))
  }

  /// Casting from an already-structured value keeps working.
  func testStructuredCastAcceptsDictionary() throws {
    struct Answer: Decodable, Equatable {
      let city: String
      let population: Int
    }

    let decoded = try Structured.cast(
      ["city": "Seattle", "population": 749_256] as [String: Any], as: Answer.self)
    XCTAssertEqual(decoded, Answer(city: "Seattle", population: 749_256))
  }

  // MARK: - Streaming dispatch

  /// `run` has to notice the streaming option.
  ///
  /// Routing a streaming request through the buffered path hands raw SSE
  /// frames to a JSON decoder.
  func testIsStreamingReadsModelOptions() throws {
    let streaming = try Prompty.load([
      "kind": "prompt",
      "name": "streams",
      "model": ["id": "gpt-4o-mini", "options": ["additionalProperties": ["stream": true]]],
    ])
    XCTAssertTrue(Pipeline.isStreaming(streaming))

    let buffered = try Prompty.load([
      "kind": "prompt",
      "name": "buffered",
      "model": ["id": "gpt-4o-mini", "options": ["additionalProperties": ["stream": false]]],
    ])
    XCTAssertFalse(Pipeline.isStreaming(buffered))

    let unset = try Prompty.load([
      "kind": "prompt", "name": "unset", "model": ["id": "gpt-4o-mini"],
    ])
    XCTAssertFalse(Pipeline.isStreaming(unset))
  }
}

/// A parser whose only job is to return a chosen `preRender` result.
private struct StubParser: Parser {
  let preRenderResult: Any?

  func preRender(template: String) throws -> Any? { preRenderResult }

  func parse(agent: Prompty, rendered: String, context: [String: Any]?) async throws -> [Message] {
    [Message.user(text: rendered)]
  }
}

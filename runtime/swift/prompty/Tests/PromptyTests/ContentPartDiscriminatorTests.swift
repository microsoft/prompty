import Foundation

import PromptyModel

import XCTest

@testable import Prompty

/// Strict-discriminator acceptance gate for `ContentPart`.
///
/// This is the Swift half of the shared acceptance strengthened by Agent
/// PR #447 commit `0c64ef33`, whose canonical vector is
/// `spec/vectors/model/content_part_discriminator_vectors.json`.
///
/// That vector is **not checked out on this branch** — `spec/vectors/model/`
/// is absent here — but it does exist in repository history, added by commit
/// `b820d785` ("Define strict content part discriminators"). The three cases
/// below are transcribed from that commit *verbatim*, including payload fields
/// the discriminator logic never reads, so this suite cannot pass on a
/// simplified input that the real vector would reject.
///
/// ``testCanonicalVectorWhenPresent`` drives the same assertions directly off
/// the vector file and activates automatically once it lands on this branch,
/// at which point the inline mirror becomes redundant and can be deleted.
///
/// The contract under test, from the vector's own description — "ContentPart
/// is closed and case-sensitive: unknown kinds are rejected rather than
/// preserved like unknown Connection values or dispatched like unknown Tool
/// values":
///
/// 1. `text` loads unchanged;
/// 2. `video` is rejected — it is not a member of the closed union;
/// 3. `Text` is rejected — matching is exact and case-sensitive;
/// 4. rejection surfaces a *structured* diagnostic exposing the field `kind`
///    and the offending raw value verbatim.
///
/// `ContentPart` is **closed**: unlike `Connection` (which passes unknown
/// kinds through) and `Tool` (which dispatches them to `CustomTool`), it must
/// never gain a Swift `.unknown` case. All three policies are pinned against
/// each other in ``testClosedContentPartIsIndependentOfOpenUnions``.
///
/// Closedness itself is enforced at *compile time* — see ``caseName(_:)``.
final class ContentPartDiscriminatorTests: XCTestCase {

  // MARK: - Canonical inputs, transcribed from commit b820d785

  /// `known_text_content_part_loads`
  private static let textInput: [String: Any] = ["kind": "text", "value": "hello"]

  /// `unknown_content_part_kind_is_rejected`. `durationSeconds` is carried
  /// deliberately: a loader that accepted `video` only for a particular
  /// payload shape would pass a stripped-down input but fail the real vector.
  private static let videoInput: [String: Any] = [
    "kind": "video",
    "source": "https://example.test/video.mp4",
    "durationSeconds": 3,
  ]

  /// `content_part_case_collision_is_rejected`
  private static let capitalTextInput: [String: Any] = [
    "kind": "Text", "value": "case-sensitive",
  ]

  // MARK: - Helpers

  /// Exhaustive switch with no `default:`.
  ///
  /// This is the closedness gate. If a future emitter adds an `.unknown` case
  /// to `ContentPart`, this function stops compiling and the whole suite fails
  /// to build — an earlier and louder signal than any runtime assertion.
  ///
  /// It is deliberately broader than "no `.unknown`": it freezes the case set,
  /// so *any* added member breaks the build and forces a human decision. Two
  /// other exhaustive switches (the generated `save()` and the runtime's
  /// `OpenAIWire.part(_:)`) happen to break first today, but both are code an
  /// emitter change could update automatically. This one cannot be updated
  /// without editing a test, which is the review signal worth keeping.
  ///
  /// Do not add a `default:` branch here.
  private func caseName(_ part: ContentPart) -> String {
    switch part {
    case .textPart: return "textPart"
    case .imagePart: return "imagePart"
    case .filePart: return "filePart"
    case .audioPart: return "audioPart"
    }
  }

  /// Asserts that `raw` is rejected by `ContentPart.load` with the specific
  /// structured diagnostic the acceptance requires.
  ///
  /// Deliberately stricter than `XCTAssertThrowsError`: a bare "it threw"
  /// assertion would also pass for `invalidObject` or `invalidField`, so this
  /// pattern-matches the exact error case and checks that the reported field is
  /// `kind` and the reported value is the offending discriminator verbatim.
  private func assertRejects(
    _ raw: [String: Any],
    expectedValue: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    do {
      let part = try ContentPart.load(raw)
      XCTFail(
        "expected \(expectedValue) to be rejected, got \(caseName(part))",
        file: file, line: line)
    } catch {
      assertDiagnostic(error, expectedValue: expectedValue, file: file, line: line)
    }
  }

  /// Shared diagnostic assertion, so nested-path tests hold the error to the
  /// same standard as direct loads instead of merely checking that something
  /// was thrown.
  private func assertDiagnostic(
    _ error: Error,
    expectedValue: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    guard let typed = error as? TypraRuntimeError else {
      XCTFail("expected TypraRuntimeError, got \(error)", file: file, line: line)
      return
    }
    guard case .unknownDiscriminator(let type, let field, let value) = typed else {
      XCTFail("expected .unknownDiscriminator, got \(typed)", file: file, line: line)
      return
    }
    XCTAssertEqual(
      type, "ContentPart", "diagnostic must name the type", file: file, line: line)
    XCTAssertEqual(field, "kind", "diagnostic must expose the field", file: file, line: line)
    XCTAssertEqual(
      value, expectedValue, "diagnostic must expose the raw value verbatim",
      file: file, line: line)

    // Foundation's `StringProtocol.contains` overload bridges to
    // `NSString.range(of:)`, which reports `false` for an empty needle — the
    // opposite of the stdlib overload's `true`. Both were verified on the
    // toolchain in use. The check is therefore only meaningful, and only
    // applied, for a non-empty discriminator.
    if !expectedValue.isEmpty {
      XCTAssertTrue(
        typed.description.contains(expectedValue),
        "rendered message must carry the raw value, got: \(typed.description)",
        file: file, line: line)
    }
  }

  private func canonical(_ value: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    return String(decoding: data, as: UTF8.self)
  }

  private var canonicalVectorURL: URL {
    Spec.root.appendingPathComponent("vectors/model/content_part_discriminator_vectors.json")
  }

  // MARK: - 1. text loads unchanged

  func testTextLoadsUnchanged() throws {
    let raw = Self.textInput
    let part = try ContentPart.load(raw)

    guard case .textPart(let text) = part else {
      return XCTFail("expected .textPart, got \(caseName(part))")
    }
    XCTAssertEqual(text.kind, "text")
    XCTAssertEqual(text.value, "hello")

    // "Unchanged" is a round-trip claim, not just a field claim. `TextPart`
    // has exactly `kind` and `value`, so strict equality is safe — and a
    // newly emitted or defaulted field *should* fail an "unchanged" gate.
    XCTAssertEqual(try canonical(try part.save()), try canonical(raw))
  }

  func testTextRoundTripIsIdempotent() throws {
    var current = try canonical(Self.textInput)
    for pass in 0..<3 {
      let object = try JSONSerialization.jsonObject(with: Data(current.utf8))
      let saved = try ContentPart.load(object).save()
      XCTAssertEqual(try canonical(saved), current, "drift on pass \(pass)")
      current = try canonical(saved)
    }
  }

  func testAllKnownKindsResolve() throws {
    let cases: [(String, String)] = [
      ("text", "textPart"),
      ("image", "imagePart"),
      ("file", "filePart"),
      ("audio", "audioPart"),
    ]
    for (kind, expected) in cases {
      var raw: [String: Any] = ["kind": kind]
      if kind == "text" {
        raw["value"] = "v"
      } else {
        raw["source"] = "s"
      }
      let part = try ContentPart.load(raw)
      XCTAssertEqual(caseName(part), expected, "kind \(kind)")
    }
  }

  // MARK: - 2. video rejects

  func testVideoIsRejected() {
    assertRejects(Self.videoInput, expectedValue: "video")
  }

  /// `video` must be rejected on the discriminator alone, regardless of how
  /// plausible or sparse the rest of the payload is. Guards against a future
  /// "recover by shape" heuristic quietly reopening the union.
  func testVideoIsRejectedRegardlessOfPayloadShape() {
    assertRejects(["kind": "video", "value": "looks like a text part"], expectedValue: "video")
    assertRejects(["kind": "video"], expectedValue: "video")
  }

  // MARK: - 3. Text rejects (case-sensitive)

  func testCapitalTextIsRejected() {
    assertRejects(Self.capitalTextInput, expectedValue: "Text")
  }

  /// The two payloads below differ *only* in the casing of the discriminator,
  /// so exact, case-sensitive matching is the sole thing that can separate an
  /// accepted load from a rejected one.
  func testCapitalTextDiffersFromTextOnlyByCasing() throws {
    let accepted: [String: Any] = ["kind": "text", "value": "case-sensitive"]
    let rejected: [String: Any] = ["kind": "Text", "value": "case-sensitive"]

    XCTAssertNoThrow(try ContentPart.load(accepted))
    assertRejects(rejected, expectedValue: "Text")
  }

  func testOtherCasingsAreAlsoRejected() {
    for kind in ["TEXT", "Image", "IMAGE", "File", "Audio", "AUDIO", "tExT"] {
      assertRejects(["kind": kind, "value": "v", "source": "s"], expectedValue: kind)
    }
  }

  func testAdjacentUnknownKindsAreRejected() {
    for kind in [" text", "text ", "video/mp4", "textPart", "unknown"] {
      assertRejects(["kind": kind, "value": "v"], expectedValue: kind)
    }
  }

  /// An explicitly empty discriminator is rejected. The generated loader gates
  /// on `discriminator.isEmpty` before dispatch, so an empty `kind` surfaces as
  /// `.invalidField(field: "kind", expected: "non-blank string")` rather than an
  /// unknown-discriminator (there is no value to echo).
  func testEmptyKindIsRejected() {
    XCTAssertThrowsError(try ContentPart.load(["kind": "", "value": "empty kind"])) { error in
      guard case .invalidField(let field, let expected)? = error as? TypraRuntimeError else {
        return XCTFail("expected .invalidField, got \(error)")
      }
      XCTAssertEqual(field, "kind")
      XCTAssertEqual(expected, "non-blank string")
    }
  }

  /// A *missing* `kind` is rejected too. The loader coalesces an absent value to
  /// `NSNull`, which fails the `TypraRuntime.string` gate, so it surfaces as
  /// `.invalidField(field: "kind", expected: "string")`. Only the field is
  /// pinned; the exact `expected` text is a diagnostic detail owned by the
  /// runtime.
  func testMissingKindIsRejected() {
    XCTAssertThrowsError(try ContentPart.load(["value": "no kind at all"])) { error in
      guard case .invalidField(let field, _)? = error as? TypraRuntimeError else {
        return XCTFail("expected .invalidField, got \(error)")
      }
      XCTAssertEqual(field, "kind")
    }
  }

  // MARK: - 4. Rejection is not swallowed by nesting

  /// `ContentPart` is reached in practice through `Message.parts`. A union that
  /// rejects in isolation but is skipped, defaulted or dropped when nested
  /// would satisfy a naive gate while still losing data.
  func testRejectionPropagatesThroughMessage() {
    let raw: [String: Any] = [
      "role": "user",
      "parts": [["kind": "text", "value": "fine"], Self.videoInput],
    ]
    XCTAssertThrowsError(try Message.load(raw)) { error in
      self.assertDiagnostic(error, expectedValue: "video")
    }
  }

  /// The second nested path.
  func testRejectionPropagatesThroughToolResult() {
    let raw: [String: Any] = ["parts": [Self.capitalTextInput]]
    XCTAssertThrowsError(try ToolResult.load(raw)) { error in
      self.assertDiagnostic(error, expectedValue: "Text")
    }
  }

  /// Rejection has to win even when the invalid part is not the first element,
  /// so a valid sibling cannot mask it.
  func testRejectionIsNotMaskedByValidSiblings() {
    let raw: [String: Any] = [
      "role": "assistant",
      "parts": [
        ["kind": "text", "value": "one"],
        ["kind": "image", "source": "two"],
        Self.videoInput,
      ],
    ]
    XCTAssertThrowsError(try Message.load(raw)) { error in
      self.assertDiagnostic(error, expectedValue: "video")
    }
  }

  // MARK: - Closed ContentPart vs the open Tool union

  /// Pins the two opposing unknown-kind policies against each other using the
  /// *identical* payload, so no shape-based heuristic can satisfy this by
  /// accident: `Tool` is an open union that dispatches an unknown kind to
  /// `CustomTool`, while `ContentPart` is closed and refuses it outright.
  ///
  /// This is not the only thing keeping the policies apart — the rejection
  /// tests above pin the closed side — but it is the only place the contrast is
  /// asserted against one shared input.
  func testClosedContentPartIsIndependentOfOpenUnions() throws {
    let shared: [String: Any] = [
      "kind": "future-auth",
      "name": "shared",
      "connection": [
        "kind": "key",
        "endpoint": "https://example.test",
        "apiKey": "x",
      ],
    ]

    let tool = try Tool.load(shared)
    guard case .customTool = tool else {
      return XCTFail("Tool must dispatch unknown kinds to CustomTool")
    }

    // Same input, opposite policy.
    assertRejects(shared, expectedValue: "future-auth")
  }

  /// `ContentPart` must not acquire a passthrough representation. The
  /// compile-time gate is ``caseName(_:)``; this is the behavioural half.
  func testUnknownContentPartNeverSurvivesLoad() {
    for kind in ["video", "Text", "future-auth", "custom"] {
      XCTAssertThrowsError(
        try ContentPart.load(["kind": kind, "value": "v"]),
        "\(kind) must not be representable"
      ) { error in
        self.assertDiagnostic(error, expectedValue: kind)
      }
    }
  }

  // MARK: - Vector-driven run, active once the vector lands

  /// Drives the same contract straight off the canonical vector.
  ///
  /// Skips while `spec/vectors/model/` is absent from this branch; the inline
  /// transcription above covers the identical cases in the meantime. When the
  /// vector arrives this activates with no code change, and the inline mirror
  /// can then be deleted.
  func testCanonicalVectorWhenPresent() throws {
    let url = canonicalVectorURL
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw XCTSkip("canonical vector not on this branch; inline mirror covers the same cases")
    }

    let data = try Data(contentsOf: url)
    let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    let vectors = root?["vectors"] as? [[String: Any]] ?? []
    XCTAssertFalse(vectors.isEmpty, "vector file declares no cases")

    for vector in vectors {
      let name = vector["name"] as? String ?? "<unnamed>"
      guard let input = vector["input"] as? [String: Any] else {
        XCTFail("\(name): missing input")
        continue
      }
      let expected = vector["expected"] as? [String: Any] ?? [:]

      switch vector["operation"] as? String {
      case "load":
        let part = try ContentPart.load(input)
        XCTAssertEqual(
          try canonical(try part.save()), try canonical(expected),
          "\(name): loaded value must match expected")

      case "load-error":
        XCTAssertEqual(
          expected["discriminator"] as? String, "kind",
          "\(name): vector expects a different field")
        assertRejects(input, expectedValue: expected["value"] as? String ?? "")

      case let other:
        XCTFail("\(name): unsupported operation \(other ?? "nil")")
      }
    }
  }
}

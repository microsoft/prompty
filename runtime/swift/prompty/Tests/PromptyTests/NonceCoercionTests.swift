import XCTest

@testable import Prompty

/// Regression tests for strict-mode nonce handling.
///
/// `generateNonce` emits 8 random bytes as 16 hex characters. Hex is a superset
/// of decimal, so coercing attribute values corrupted roughly 1 in 1,200
/// generated nonces (measured: 165 failures in 200,000 trials). The round-trip
/// was not identity, so strict mode rejected its own untampered output with
/// "possible prompt injection detected".
///
/// This surfaced as an intermittent failure of a live end-to-end test that has
/// no template inputs at all — the nonce was the only thing varying between
/// runs, and the throw happened in about a millisecond, before any network call.
///
/// The nonces below were crafted to hit every distinct corruption mode, so these
/// tests fail deterministically if the exemption in `parseAttributes` is removed
/// rather than about once per thousand runs.
final class NonceCoercionTests: XCTestCase {

  /// Nonces that are shaped like numbers, one per corruption mode.
  ///
  /// Every string is a valid `generateNonce` output: 16 characters drawn from
  /// `[0-9a-f]`. The final two are controls that were never at risk.
  private static let numericLookingNonces: [(nonce: String, mode: String)] = [
    ("0123456789012345", "leading zero stripped by Int parsing"),
    ("0419856025378190", "leading zero stripped by Int parsing"),
    ("1234567890123456", "parses cleanly as Int"),
    ("9789350921772800", "parses as Int, then normalizes to 9.7893509217728e+15"),
    ("9677e80871924237", "scientific notation overflows Double to inf"),
    ("0663512342083e99", "scientific notation, exponent within Double range"),
    ("00000000000000e1", "leading zeros plus exponent"),
    ("9e99999999999999", "exponent overflows Double to inf"),
    ("45e12345678901ab", "trailing hex letters block numeric parsing"),
    ("abcdef0123456789", "leading hex letter blocks numeric parsing"),
  ]

  /// A nonce must survive the parser that produced it, whatever it looks like.
  func testNumericLookingNoncesRoundTripThroughAttributeParsing() throws {
    for (nonce, mode) in Self.numericLookingNonces {
      let attributes = PromptyChatParser.parseAttributes("[nonce=\"\(nonce)\"]")
      let parsed = attributes["nonce"]

      XCTAssertEqual(
        parsed as? String, nonce,
        "nonce \(nonce) was not preserved as a String (\(mode))"
      )
      XCTAssertEqual(
        JSONSupport.stringify(parsed), nonce,
        "nonce \(nonce) did not round-trip to its original text (\(mode))"
      )
    }
  }

  /// The end-to-end symptom: strict parsing rejecting its own untampered output.
  func testStrictParsingAcceptsNumericLookingNonces() throws {
    for (nonce, mode) in Self.numericLookingNonces {
      let rendered = """
        system[nonce="\(nonce)"]:
        You are a helpful assistant.

        user[nonce="\(nonce)"]:
        Hello.
        """

      let messages = try PromptyChatParser.parseChat(rendered, expectedNonce: nonce)

      XCTAssertEqual(
        messages.count, 2,
        "strict parsing dropped messages for nonce \(nonce) (\(mode))"
      )
      XCTAssertEqual(messages.first?.role, .system)
      XCTAssertEqual(messages.last?.role, .user)
    }
  }

  /// The exemption must not weaken injection detection, which is its whole point.
  func testNumericLookingNonceMismatchIsStillRejected() {
    let rendered = """
      system[nonce="0123456789012345"]:
      You are a helpful assistant.
      """

    XCTAssertThrowsError(
      try PromptyChatParser.parseChat(rendered, expectedNonce: "0123456789012346")
    ) { error in
      XCTAssertTrue(
        "\(error)".contains("prompt injection"),
        "expected an injection diagnostic, got \(error)"
      )
    }
  }

  /// Two nonces that coerce to the same number must not be conflated.
  ///
  /// `0123456789012345` and `123456789012345` differ only by a leading zero, and
  /// under the old behavior both became the integer `123456789012345`.
  ///
  /// This is a canonicalization assertion, **not** a demonstrated bypass. The
  /// expected nonce is taken straight from `generateNonce` and is never routed
  /// through `parseAttributes`, so it is never coerced, and it is always exactly
  /// 16 characters — the 15-character value used here cannot be produced. Under
  /// the old code the collision therefore made validation fail closed (a
  /// generated `0123456789012345` was rejected against its own expectation),
  /// which is an availability defect rather than an authentication one. The
  /// assertion is kept because collapsing distinct tokens onto one value is a
  /// property worth pinning regardless of current exploitability.
  func testNoncesDifferingOnlyByLeadingZeroAreNotConflated() {
    let rendered = """
      system[nonce="0123456789012345"]:
      You are a helpful assistant.
      """

    XCTAssertThrowsError(
      try PromptyChatParser.parseChat(rendered, expectedNonce: "123456789012345")
    ) { error in
      XCTAssertTrue(
        "\(error)".contains("prompt injection"),
        "expected an injection diagnostic, got \(error)"
      )
    }
  }

  /// Every nonce this runtime can actually generate must validate.
  ///
  /// The crafted cases above pin known modes; this sweep guards against modes
  /// nobody thought of. 20,000 trials against a measured 1-in-1,212 failure rate
  /// makes a regression essentially certain to be caught.
  func testGeneratedNoncesAlwaysValidate() throws {
    for _ in 0..<20_000 {
      let nonce = PromptyChatParser.generateNonce()
      let attributes = PromptyChatParser.parseAttributes("[nonce=\"\(nonce)\"]")

      XCTAssertEqual(
        JSONSupport.stringify(attributes["nonce"]), nonce,
        "generated nonce \(nonce) did not survive attribute parsing"
      )
    }
  }

  /// Exempting `nonce` must not stop other attributes from being coerced.
  ///
  /// The bug is easy to "fix" by dropping coercion wholesale, which would
  /// silently change the type of documented attributes such as `[index=1]`.
  func testNonNonceAttributesAreStillCoerced() {
    let attributes = PromptyChatParser.parseAttributes(
      "[nonce=\"0123456789012345\",index=1,ratio=0.5,active=true,name=\"Alice\"]"
    )

    XCTAssertEqual(attributes["nonce"] as? String, "0123456789012345")
    XCTAssertEqual(attributes["index"] as? Int, 1)
    XCTAssertEqual(attributes["ratio"] as? Double, 0.5)
    XCTAssertEqual(attributes["active"] as? Bool, true)
    XCTAssertEqual(attributes["name"] as? String, "Alice")
  }

  /// Non-nonce attributes still reach message metadata; the nonce still does not.
  ///
  /// This exercises `parseChat` on handcrafted rendered text rather than the
  /// full strict pipeline, because `preRender` rebuilds each role marker with
  /// only the nonce and drops any attributes the author wrote. That discards
  /// `existing_attrs`, which `spec/spec.md:1141-1142` requires preserving. Rust
  /// does the same (`parsers/prompty.rs:56`), so it is a cross-runtime
  /// deviation, reported separately and deliberately not fixed here.
  func testNonceIsStrippedFromMetadataWhileOtherAttributesSurvive() throws {
    let nonce = "0123456789012345"
    let rendered = """
      system[nonce="\(nonce)",index=1]:
      You are a helpful assistant.
      """

    let messages = try PromptyChatParser.parseChat(rendered, expectedNonce: nonce)

    XCTAssertEqual(messages.count, 1)
    let metadata = try XCTUnwrap(messages.first?.metadata)
    XCTAssertNil(metadata["nonce"], "the nonce is a transport detail, not metadata")
    XCTAssertEqual(metadata["index"] as? Int, 1)
  }
}

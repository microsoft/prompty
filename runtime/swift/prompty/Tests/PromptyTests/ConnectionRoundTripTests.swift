import Foundation

import XCTest

/// Public load/save/reload gate for unknown `Connection` kinds.
///
/// This is the Swift half of the canonical acceptance recorded in
/// `spec/spec.md` §2.5 and `spec/vectors/model/connection_roundtrip_vectors.json`.
/// Neither of those exists on this branch yet — the canonical vector landed on
/// a branch that carries no Swift runtime tree — so the three required cases
/// are declared inline here and will be repointed at the shared vector once
/// both live on the same commit. ``testCanonicalVectorStillAbsent`` is the
/// tripwire for that.
///
/// The contract under test, in the exact words of the acceptance:
///
/// 1. a known lowercase `reference` kind stays known and unchanged;
/// 2. an unknown `future-auth` kind preserves its discriminator **exactly**
///    and its payload **completely**, including nested object, list, null,
///    int, float and bool;
/// 3. a case-collision `Reference` is unknown — matching is case-sensitive —
///    and preserves its full payload.
///
/// Unknown `Connection` is deliberately independent of unknown `Tool`. `Tool`
/// has a wildcard subtype in TypeSpec and resolves to `CustomTool`;
/// `Connection` has none, so its passthrough is a distinct representation
/// reached by a different path. ``testUnknownConnectionIsIndependentOfCustomTool``
/// pins that they do not depend on one another.
///
/// Everything here goes through the **public** API — `Prompty.load`,
/// `Connection.load`, `.save()` — so it tests the shipped surface rather than
/// generated internals, and no generated file is edited to make it pass.
@testable import Prompty
import PromptyModel

final class ConnectionRoundTripTests: XCTestCase {

  // MARK: - Payloads

  /// An unknown kind carrying one of every JSON type the acceptance names.
  ///
  /// The nested values are the point: a passthrough that only kept top-level
  /// scalars would satisfy a shallower test and still lose data.
  private func futureAuthPayload() -> [String: Any] {
    [
      "kind": "future-auth",
      "endpoint": "https://future.example.com",
      "nested": [
        "inner": "value",
        "innerNull": NSNull(),
        "innerList": [1, 2, 3],
        "deeper": ["level": 3],
      ],
      "list": ["a", 1, 2.5, true, NSNull()],
      "nullValue": NSNull(),
      "intValue": 42,
      "floatValue": 3.25,
      // An integral-valued float: serializes as `3`, identical to the int
      // above, so only a dynamic-type check can prove it stayed a Double.
      "floatWhole": 3.0,
      "boolTrue": true,
      "boolFalse": false,
    ]
  }

  // MARK: - Helpers

  /// Canonical JSON text, so comparison is exact rather than
  /// `Spec.equal`-lenient.
  ///
  /// ``Spec/equal(_:_:)`` normalizes `NSNull` to `nil` so a JSON null and an
  /// absent value compare equal — correct for vector comparison, wrong here,
  /// where preserving an explicit null *is* the requirement. Comparing
  /// serialized text keeps nulls, catches dropped or added keys, preserves
  /// list order, and stops a bool collapsing into a number.
  ///
  /// It does **not** separate an int from an integral float: Foundation's JSON
  /// writer emits `3.0` as `3`. Numeric fidelity is checked separately by
  /// ``assertSameShape(_:_:_:)``, which compares dynamic types.
  private func canonical(_ value: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    return try XCTUnwrap(String(data: data, encoding: .utf8))
  }

  /// Assert two payloads hold the same dynamic Swift types at every position.
  ///
  /// This is what catches numeric coercion. `42` and `42.0` serialize to the
  /// same JSON text, so ``canonical(_:)`` cannot tell them apart; `Int` and
  /// `Double` are different types, so this can. It also catches a value that
  /// has been pushed through `NSNumber` or restringified along the way.
  private func assertSameShape(
    _ actual: Any, _ expected: Any, _ path: String = "root",
    file: StaticString = #filePath, line: UInt = #line
  ) {
    switch (expected, actual) {
    case (let e as [String: Any], let a as [String: Any]):
      XCTAssertEqual(
        Set(a.keys), Set(e.keys), "key set differs at \(path)", file: file, line: line)
      for (key, expectedValue) in e {
        guard let actualValue = a[key] else { continue }
        assertSameShape(actualValue, expectedValue, "\(path).\(key)", file: file, line: line)
      }
    case (let e as [Any], let a as [Any]):
      XCTAssertEqual(a.count, e.count, "list length differs at \(path)", file: file, line: line)
      for (index, expectedValue) in e.enumerated() where index < a.count {
        assertSameShape(a[index], expectedValue, "\(path)[\(index)]", file: file, line: line)
      }
    default:
      XCTAssertTrue(
        type(of: actual) == type(of: expected),
        "\(path): type changed from \(type(of: expected)) to \(type(of: actual))",
        file: file, line: line)
    }
  }

  /// Load a connection, save it, and load the saved form again.
  private func roundTrip(_ payload: [String: Any]) throws -> (
    first: Connection, saved: [String: Any], reloaded: Connection, resaved: [String: Any]
  ) {
    let first = try Connection.load(payload)
    let saved = try first.save()
    let reloaded = try Connection.load(saved)
    let resaved = try reloaded.save()
    return (first, saved, reloaded, resaved)
  }

  private func unknownPayload(_ connection: Connection, _ label: String) throws -> [String: Any] {
    guard case .unknown(let raw) = connection else {
      return try XCTUnwrap(nil as [String: Any]?, "\(label) is not .unknown: \(connection)")
    }
    return raw
  }

  // MARK: - Case 1 — known kind stays known

  /// A known lowercase `reference` must stay known and survive unchanged.
  ///
  /// This is the control. Without it, a passthrough that swallowed *every*
  /// kind — including the known ones — would pass cases 2 and 3 while having
  /// destroyed the typed model entirely.
  func testKnownReferenceStaysKnownAndUnchanged() throws {
    let payload: [String: Any] = [
      "kind": "reference",
      "name": "my-connection",
      "target": "azure-openai",
    ]

    let result = try roundTrip(payload)

    guard case .referenceConnection(let first) = result.first else {
      return XCTFail("known 'reference' did not load as ReferenceConnection: \(result.first)")
    }
    guard case .referenceConnection(let reloaded) = result.reloaded else {
      return XCTFail("known 'reference' lost its type on reload: \(result.reloaded)")
    }

    XCTAssertEqual(first.name, "my-connection")
    XCTAssertEqual(first.target, "azure-openai")
    XCTAssertEqual(reloaded.name, first.name)
    XCTAssertEqual(reloaded.target, first.target)

    XCTAssertEqual(result.saved["kind"] as? String, "reference")
    XCTAssertEqual(
      try canonical(result.saved), try canonical(payload),
      "known connection did not survive the round trip unchanged")
    XCTAssertEqual(
      try canonical(result.resaved), try canonical(payload),
      "known connection is not stable across reload")
  }

  // MARK: - Case 2 — unknown kind, exact discriminator, complete payload

  /// `future-auth` is unknown: the discriminator survives byte-exact and the
  /// payload survives whole, including every nested JSON type.
  func testUnknownFutureAuthPreservesDiscriminatorAndPayload() throws {
    let payload = futureAuthPayload()
    let result = try roundTrip(payload)

    let raw = try unknownPayload(result.first, "future-auth")
    XCTAssertEqual(
      raw["kind"] as? String, "future-auth",
      "the discriminator must survive exactly, not be normalized or defaulted")

    // Whole-payload exactness: keys, nesting, list order, explicit nulls.
    XCTAssertEqual(
      try canonical(result.saved), try canonical(payload),
      "unknown connection payload was not preserved completely")
    XCTAssertEqual(
      try canonical(result.resaved), try canonical(payload),
      "unknown connection payload degraded on reload")

    // Type fidelity, which canonical text cannot see. Asserted on the
    // *reloaded* payload, so a coercion introduced by save or by the second
    // load is caught rather than only one applied on the way in.
    let reloadedRaw = try unknownPayload(result.reloaded, "future-auth after reload")
    assertSameShape(result.saved, payload, "saved")
    assertSameShape(reloadedRaw, payload, "reloaded")
    assertSameShape(result.resaved, payload, "resaved")

    // Spot-check the individual types the acceptance calls out, so a failure
    // says which one was lost rather than just 'the JSON differs'. These read
    // from the reloaded payload for the same reason.
    XCTAssertEqual(reloadedRaw["intValue"] as? Int, 42)
    XCTAssertEqual(reloadedRaw["floatValue"] as? Double, 3.25)
    XCTAssertEqual(reloadedRaw["boolTrue"] as? Bool, true)
    XCTAssertEqual(reloadedRaw["boolFalse"] as? Bool, false)
    XCTAssertTrue(reloadedRaw["nullValue"] is NSNull, "explicit null was dropped")
    XCTAssertEqual((reloadedRaw["nested"] as? [String: Any])?["inner"] as? String, "value")
    XCTAssertTrue(
      (reloadedRaw["nested"] as? [String: Any])?["innerNull"] is NSNull, "nested null was dropped")
    XCTAssertEqual((reloadedRaw["list"] as? [Any])?.count, 5)

    // A bool must not have decayed into a number on the way through.
    let boolText = try canonical(["v": reloadedRaw["boolTrue"] as Any])
    XCTAssertEqual(boolText, "{\"v\":true}", "bool was coerced to a number")
  }

  /// Reload must be idempotent — a second and third pass change nothing.
  ///
  /// One round trip can hide a transform that is only applied on the way in;
  /// running it again is what catches drift that compounds.
  func testUnknownConnectionRoundTripIsIdempotent() throws {
    let payload = futureAuthPayload()
    var current = try Connection.load(payload)
    let expected = try canonical(payload)

    for pass in 1...3 {
      let saved = try current.save()
      XCTAssertEqual(try canonical(saved), expected, "payload drifted on pass \(pass)")
      current = try Connection.load(saved)
    }
  }

  // MARK: - Case 3 — case-collision is unknown

  /// `Reference` is **not** `reference`. Matching is exact and case-sensitive,
  /// so a differently-cased known kind is unknown and keeps its full payload.
  ///
  /// This is the case a case-insensitive `switch` would silently get wrong: it
  /// would bind `Reference` to `ReferenceConnection` and drop every field that
  /// type does not declare.
  func testCaseCollisionReferenceIsUnknownAndPreservesPayload() throws {
    let payload: [String: Any] = [
      "kind": "Reference",
      "name": "my-connection",
      "target": "azure-openai",
      "extraField": "must survive",
      "nested": ["a": 1, "b": NSNull()],
    ]

    let result = try roundTrip(payload)

    let raw = try unknownPayload(result.first, "case-collision 'Reference'")
    XCTAssertEqual(
      raw["kind"] as? String, "Reference",
      "the discriminator was case-folded; matching must be case-sensitive")

    XCTAssertEqual(
      try canonical(result.saved), try canonical(payload),
      "case-collision payload was not preserved completely")
    XCTAssertEqual(
      try canonical(result.resaved), try canonical(payload),
      "case-collision payload degraded on reload")

    // The fields ReferenceConnection does not declare are exactly what a
    // wrong case-insensitive match would have discarded.
    XCTAssertEqual(raw["extraField"] as? String, "must survive")
    XCTAssertTrue((raw["nested"] as? [String: Any])?["b"] is NSNull)
  }

  /// Every other casing is unknown too, so the rule is 'exact match' rather
  /// than 'these two spellings are special'.
  func testOtherCasingsAreAlsoUnknown() throws {
    for kind in ["REFERENCE", "Key", "REMOTE", "Anonymous", "OAuth", "Foundry"] {
      let connection = try Connection.load(["kind": kind, "marker": kind])
      guard case .unknown(let raw) = connection else {
        XCTFail("'\(kind)' matched a known subtype; matching is not case-sensitive")
        continue
      }
      XCTAssertEqual(raw["kind"] as? String, kind)
      XCTAssertEqual(raw["marker"] as? String, kind)
    }
  }

  /// The known kinds still resolve, so case sensitivity did not simply break
  /// matching for everything.
  func testCanonicalLowercaseKindsAllResolve() throws {
    // Matched by pattern rather than by rendered description: an enum's
    // `String(describing:)` is a debug affordance, not a contract.
    let cases: [(String, (Connection) -> Bool)] = [
      ("reference", { if case .referenceConnection = $0 { return true } else { return false } }),
      ("remote", { if case .remoteConnection = $0 { return true } else { return false } }),
      ("key", { if case .apiKeyConnection = $0 { return true } else { return false } }),
      ("anonymous", { if case .anonymousConnection = $0 { return true } else { return false } }),
      ("oauth", { if case .oAuthConnection = $0 { return true } else { return false } }),
      ("foundry", { if case .foundryConnection = $0 { return true } else { return false } }),
    ]

    for (kind, matches) in cases {
      let connection = try Connection.load(["kind": kind])
      if case .unknown = connection {
        XCTFail("known kind '\(kind)' fell through to .unknown")
        continue
      }
      XCTAssertTrue(matches(connection), "'\(kind)' resolved to the wrong subtype")
    }
  }

  // MARK: - Independence from Tool → CustomTool

  /// Unknown `Connection` and unknown `Tool` are separate mechanisms.
  ///
  /// `Tool` has a wildcard subtype in TypeSpec, so an unknown kind becomes a
  /// typed `CustomTool`; `Connection` has none, so its unknown kind is a raw
  /// passthrough. They are reached by different paths, and the point here is
  /// that both resolve correctly *in the same document* — neither mechanism
  /// is standing in for the other.
  ///
  /// Both are exercised as unknowns deliberately. A known tool would let this
  /// pass even if `Tool` → `CustomTool` were completely broken.
  func testUnknownConnectionIsIndependentOfCustomTool() throws {
    let connection: [String: Any] = [
      "kind": "future-auth", "endpoint": "https://future.example.com",
    ]

    let agent = try Prompty.load([
      "kind": "prompt",
      "name": "independence",
      "model": ["id": "gpt-4o-mini", "apiType": "chat", "connection": connection],
      "tools": [
        ["name": "unknown_kind_tool", "kind": "some-future-tool", "description": "forward compat"],
        [
          "name": "known_fn", "kind": "function",
          "parameters": [["name": "city", "kind": "string"]],
        ],
      ],
      "instructions": "user:\nhi",
    ])

    let tools = try XCTUnwrap(agent.tools)
    XCTAssertEqual(tools.count, 2)

    // The unknown tool took the Tool wildcard path.
    guard case .customTool(let custom) = tools[0] else {
      return XCTFail("an unknown tool kind did not become a CustomTool: \(tools[0])")
    }
    XCTAssertEqual(custom.kind, "some-future-tool", "the tool discriminator was not preserved")
    XCTAssertEqual(custom.name, "unknown_kind_tool")

    // The known tool was not swept up by that wildcard.
    guard case .functionTool = tools[1] else {
      return XCTFail("a known function tool was reclassified: \(tools[1])")
    }

    // And the connection took its own, separate path.
    guard case .unknown(let raw) = try XCTUnwrap(agent.model.connection) else {
      return XCTFail("unknown connection inside a Prompty was not passed through")
    }
    XCTAssertEqual(raw["kind"] as? String, "future-auth")
    XCTAssertEqual(raw["endpoint"] as? String, "https://future.example.com")

    // Both survive a document save/reload together.
    let reloaded = try Prompty.load(try agent.save())
    guard case .customTool = try XCTUnwrap(reloaded.tools?.first) else {
      return XCTFail("CustomTool did not survive the document round trip")
    }
    guard case .unknown(let reloadedRaw) = try XCTUnwrap(reloaded.model.connection) else {
      return XCTFail("unknown connection did not survive the document round trip")
    }
    XCTAssertEqual(try canonical(reloadedRaw), try canonical(connection))
  }

  /// An unknown connection nested in a Prompty survives a full document
  /// save/reload, which is the path a real `.prompty` file takes.
  func testUnknownConnectionSurvivesPromptyRoundTrip() throws {
    let connection: [String: Any] = [
      "kind": "future-auth",
      "endpoint": "https://future.example.com",
      "nested": ["retained": true, "n": NSNull()],
    ]

    let agent = try Prompty.load([
      "kind": "prompt",
      "name": "nested",
      "model": ["id": "gpt-4o-mini", "apiType": "chat", "connection": connection],
      "instructions": "user:\nhi",
    ])

    let saved = try agent.save()
    let reloaded = try Prompty.load(saved)

    let raw = try unknownPayload(
      try XCTUnwrap(reloaded.model.connection), "connection after Prompty round trip")
    XCTAssertEqual(try canonical(raw), try canonical(connection))
  }

  // MARK: - Tripwire

  /// Repoint this suite at the shared vector once it reaches this branch.
  ///
  /// The canonical cases live in
  /// `spec/vectors/model/connection_roundtrip_vectors.json`, which was added on
  /// a branch with no Swift runtime tree. When both land on one commit, delete
  /// the inline payloads above and drive them from the vector, exactly as
  /// `ToolBindingTests.testSharedBindingsInjectedVector` does.
  func testCanonicalVectorStillAbsent() throws {
    let url =
      Spec.root
      .appendingPathComponent("vectors")
      .appendingPathComponent("model")
      .appendingPathComponent("connection_roundtrip_vectors.json")

    XCTAssertFalse(
      FileManager.default.fileExists(atPath: url.path),
      """
      connection_roundtrip_vectors.json is now on this branch. Drive \
      ConnectionRoundTripTests from it instead of the inline payloads, and \
      delete this tripwire.
      """)
  }
}

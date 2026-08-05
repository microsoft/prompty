import XCTest

@testable import Prompty
@testable import PromptyModel

/// Characterization coverage for the two *different* strategies the generated
/// model uses to absorb an unrecognised discriminator, and what each one costs.
///
/// This matters beyond Swift. `Connection` is declared as a closed union in
/// `schema/model/connection/connection.tsp`, and the open question is how to
/// open it. Two shapes get proposed: declare a typed wildcard subtype (the
/// shape `CustomTool { kind: "*" }` already uses for `Tool`), or open the
/// discriminator itself so the raw payload survives. They are frequently
/// treated as interchangeable. These tests measure that, as currently emitted,
/// they are not.
///
/// - `Tool` absorbs `kind: "vendor_specific"` into the typed `CustomTool`
///   subtype. `CustomTool` declares only named fields and no raw catch-all, so
///   unrecognised top-level fields are dropped on save.
/// - `Connection` absorbs an unrecognised kind into `.unknown([String: Any])`,
///   which is a raw dictionary passthrough, so every top-level field survives —
///   including the original discriminator.
///
/// Scope carefully. What is measured is that *a wildcard subtype declaring only
/// named fields* loses unknown fields; it does not follow that every possible
/// `Connection` wildcard would, since one could declare raw catch-all storage.
/// The transferable conclusion is that the choice is not neutral and the
/// declared shape decides it. Note also that `spec.md` §2.3 (lines 246-247)
/// permits unknown properties to be "preserved in `metadata` **or ignored**",
/// so dropping them is not by itself a spec violation — it is a strictly weaker
/// forward-compatibility guarantee than the raw-passthrough path already
/// provides here.
///
/// These are characterization assertions: they pin current behaviour so that a
/// change is noticed, not behaviour the spec has blessed. `spec/spec.md` §2.5
/// does not currently state a requirement for unrecognised connection kinds
/// (see ``ConnectionRoundTripTests``), and no shared vector covers unknown
/// top-level field preservation on either type. If the wildcard-subtype path is
/// later fixed to preserve unknown fields, ``testCustomToolDropsUnknownTopLevelFields``
/// is expected to fail — treat that as the signal to re-derive the contract,
/// not as a regression to paper over.
final class WildcardPreservationTests: XCTestCase {

  // MARK: - Tool: typed wildcard subtype

  /// A typed wildcard subtype does NOT round-trip arbitrary top-level fields.
  ///
  /// Every key here is legal JSON on a forward-compatible tool entry, and only
  /// the ones `CustomTool` declares come back.
  func testCustomToolDropsUnknownTopLevelFields() throws {
    let input: [String: Any] = [
      "kind": "vendor_specific",
      "name": "vendorThing",
      "description": "a vendor tool",
      "options": ["a": 1],
      "extra": "keepme",
      "listy": [1, 2, 3],
      "nested": ["deep": ["x": 1]],
    ]

    let saved = try Tool.load(input, context: LoadContext()).save(SaveContext())

    // Declared fields survive.
    XCTAssertEqual(saved["kind"] as? String, "vendor_specific")
    XCTAssertEqual(saved["name"] as? String, "vendorThing")
    XCTAssertEqual(saved["description"] as? String, "a vendor tool")

    // Undeclared fields do not. Assert each by name: a count-only check would
    // pass if one were dropped and another injected.
    XCTAssertNil(saved["extra"], "unexpectedly preserved 'extra'")
    XCTAssertNil(saved["listy"], "unexpectedly preserved 'listy'")
    XCTAssertNil(saved["nested"], "unexpectedly preserved 'nested'")

    XCTAssertEqual(
      Set(input.keys).subtracting(saved.keys),
      ["extra", "listy", "nested"],
      "the set of dropped fields changed")
  }

  /// A *missing required* `connection` is silently accepted and materialises in
  /// saved output as an empty, schema-invalid connection.
  ///
  /// `CustomTool.connection` is required (`schema/model/tools/tool.tsp:98` — no
  /// `?`, no default). The generated loader only assigns it when the key is
  /// present (`tools/tool.swift:167-169`), so an absent key leaves the
  /// emitter-synthesised `Connection = .unknown([:])` placeholder in place, and
  /// `save` then writes it unconditionally (`tools/tool.swift:198`).
  ///
  /// Two distinct problems, worth keeping apart: the loader does not report the
  /// missing required field, and the placeholder it falls back to is not a
  /// valid `Connection` — it has no `kind`. This is the runtime-visible half of
  /// emitter defect 1b (see `schema/scripts/patch-swift-emitter-defects.mjs`),
  /// which is otherwise easy to dismiss as a build-only annoyance the shim
  /// absorbs.
  ///
  /// The Rust runtime does not do this: it stores an absent connection as
  /// `Value::Null` and guards the write with `if !connection.is_null()`
  /// (`runtime/rust/prompty/src/model/tools/tool.rs:176-179, 327-329`), so it
  /// omits the key entirely. That makes this a Swift-specific divergence rather
  /// than agreed cross-runtime behaviour.
  ///
  /// `options` is supplied here so it cannot confound the assertion: it has an
  /// explicit `{}` default (`tool.tsp:102`) and is likewise saved
  /// unconditionally, which is a separate empty-collection minimality question.
  func testMissingRequiredConnectionIsSilentlyReplacedWithEmptyConnection() throws {
    let input: [String: Any] = [
      "kind": "vendor_specific", "name": "vendorThing", "options": [String: Any](),
    ]

    let saved = try Tool.load(input, context: LoadContext()).save(SaveContext())

    XCTAssertNil(input["connection"], "fixture must not supply 'connection'")
    XCTAssertEqual(
      Set(saved.keys).subtracting(input.keys),
      ["connection"],
      "the set of injected fields changed")

    // Assert what it actually is, not merely that something is there — that is
    // what ties the injected key to the synthesised `.unknown([:])` default.
    let connection = try XCTUnwrap(saved["connection"] as? [String: Any])
    XCTAssertTrue(connection.isEmpty, "expected the empty placeholder, got \(connection)")
    XCTAssertNil(connection["kind"], "a valid Connection would carry a discriminator")
  }

  // MARK: - Connection: raw dictionary passthrough

  /// Raw passthrough DOES round-trip arbitrary top-level fields, including the
  /// unrecognised discriminator itself.
  func testUnknownConnectionPreservesEveryTopLevelField() throws {
    let input: [String: Any] = [
      "kind": "vendor_auth",
      "endpoint": "https://example.invalid",
      "extra": "keepme",
      "nested": ["deep": ["x": 1]],
    ]

    let saved = try Connection.load(input, context: LoadContext()).save(SaveContext())

    XCTAssertEqual(
      Set(saved.keys), Set(input.keys),
      "unknown Connection must neither drop nor inject top-level keys")

    // The discriminator survives verbatim. A typed subtype would be free to
    // rewrite it, which is exactly what the Rust runtime does today.
    XCTAssertEqual(saved["kind"] as? String, "vendor_auth")
    XCTAssertEqual(saved["endpoint"] as? String, "https://example.invalid")
    XCTAssertEqual(saved["extra"] as? String, "keepme")

    // Nested structure survives by value, not merely by presence.
    let nested = saved["nested"] as? [String: Any]
    let deep = nested?["deep"] as? [String: Any]
    XCTAssertEqual(deep?["x"] as? Int, 1, "nested payload did not survive intact")
  }

  /// The two strategies disagree on the same question, on the same input shape.
  /// Pinned as a single assertion so the divergence cannot quietly close in
  /// either direction without a test failing.
  func testTheTwoWildcardStrategiesDisagreeOnUnknownFieldPreservation() throws {
    let extras: [String: Any] = ["extra": "keepme", "nested": ["deep": ["x": 1]]]

    var toolInput: [String: Any] = ["kind": "vendor_specific", "name": "t"]
    toolInput.merge(extras) { current, _ in current }
    var connInput: [String: Any] = ["kind": "vendor_auth"]
    connInput.merge(extras) { current, _ in current }

    let toolSaved = try Tool.load(toolInput, context: LoadContext()).save(SaveContext())
    let connSaved = try Connection.load(connInput, context: LoadContext()).save(SaveContext())

    let toolKept = extras.keys.filter { toolSaved[$0] != nil }.sorted()
    let connKept = extras.keys.filter { connSaved[$0] != nil }.sorted()

    XCTAssertEqual(toolKept, [], "typed wildcard subtype now preserves unknown fields")
    XCTAssertEqual(
      connKept, ["extra", "nested"],
      "raw passthrough stopped preserving unknown fields")
    XCTAssertNotEqual(
      toolKept, connKept,
      "the two strategies converged; the schema choice between them is no longer neutral")
  }
}

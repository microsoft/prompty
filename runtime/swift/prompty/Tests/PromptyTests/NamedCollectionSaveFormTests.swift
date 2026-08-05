import XCTest

@testable import Prompty
@testable import PromptyModel

/// Save-form selection for collections of named entities (spec §2.9.2).
///
/// Named collections may be saved either as a name-keyed object or as a whole
/// ordered array. The canonical rule restricts the object form to **non-empty,
/// exactly-unique** names and requires the ordered-array fallback otherwise.
///
/// That precondition is not cosmetic. A JSON object cannot hold two identical
/// keys, so applying the object form to a collection with duplicate names
/// destroys entries *by construction* — silently, with no error to notice. A
/// candidate emitter was withdrawn from cross-runtime acceptance for exactly
/// this defect in another language backend: duplicate-named entries collapsed
/// on save.
///
/// These tests split into two groups, and the distinction matters:
///
/// - **Disqualifying fixtures** (duplicate names, empty name). The array
///   fallback is *mandatory*, so these assert the saved form directly as well
///   as full payload survival. Asserting the form here cannot reject legal
///   behaviour, because no legal emitter may choose the object form for these
///   inputs. Note in particular that JSON permits `""` as an object key, so an
///   emitter could illegally object-encode the empty-name fixture and still
///   round-trip both entries — payload assertions alone would not catch it.
///   Both disqualifiers are proven on `tools` *and* on `inputs`, which save
///   through different paths and can therefore fail independently.
///
///   Payloads are compared as composite `name|value` entries, never as two
///   independent projections: comparing names and values separately proves
///   both multisets survived but not which value belongs to which name. Where
///   a fixture repeats a name, the comparison is additionally positional,
///   since exchanging the payloads of two identically-named entries leaves any
///   sorted multiset unchanged and is observable only in order.
///
/// - **Qualifying fixture** (unique names). Both forms are legal, so that test
///   asserts survival and payload only, never the form and never reload order.
///
/// At the currently pinned emitter the array form is selected unconditionally,
/// including for unique names, so the qualifying test currently exercises only
/// the array path despite its "whichever form" name. A candidate emitter was
/// measured selecting the object form for unique names while correctly falling
/// back to the array form for duplicates and empty names; all of these tests
/// were validated green against it.
///
/// Order is asserted only where canonical actually promises it — in the array
/// fallback. The object form makes no ordering promise, so nothing outside that
/// one test depends on one. See `ConnectionRoundTripTests` for why an unrelated
/// test must not smuggle in an ordering assumption.
final class NamedCollectionSaveFormTests: XCTestCase {

  // MARK: - Helpers

  /// `name|description` per tool, in collection order.
  ///
  /// Deliberately a *composite* signature rather than two independent
  /// projections. Comparing sorted names and sorted descriptions separately
  /// proves both multisets survived but not their association, so an
  /// implementation that reattached the wrong payload to a name would pass.
  private func toolSignatures(_ agent: Prompty) -> [String] {
    (agent.tools ?? []).map { tool in
      switch tool {
      case .functionTool(let value): return "\(value.name)|\(value.description ?? "<nil>")"
      case .customTool(let value): return "\(value.name)|\(value.description ?? "<nil>")"
      default: return "<unexpected-tool-case>"
      }
    }
  }

  /// `name|default` per saved property entry, in saved order.
  ///
  /// Read from the saved dictionary rather than the model because a scalar
  /// `Property` resolves to the `.unknown` passthrough case, so switching on
  /// the generated enum would end up reading this same dictionary anyway.
  private func propertySignatures(of entries: [[String: Any]]) -> [String] {
    entries.map { entry in
      let name = entry["name"] as? String ?? "<no-name>"
      let value = entry["default"].map { String(describing: $0) } ?? "<nil>"
      return "\(name)|\(value)"
    }
  }

  /// Describes the chosen save form, for diagnostics only.
  private func saveForm(_ saved: [String: Any], _ key: String) -> String {
    if saved[key] is [Any] { return "ordered array" }
    if let object = saved[key] as? [String: Any] {
      return "name-keyed object with keys \(object.keys.sorted())"
    }
    return "neither array nor object: \(String(describing: saved[key]))"
  }

  /// Asserts the ordered-array fallback was chosen and returns its entries.
  ///
  /// Only call this for fixtures where the array form is *mandatory* under
  /// §2.9.2. Returns `nil` after failing, so callers `guard` rather than
  /// indexing into a collection that may not exist.
  private func requireArrayForm(
    _ saved: [String: Any],
    _ key: String,
    because reason: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) -> [[String: Any]]? {
    guard let entries = saved[key] as? [[String: Any]] else {
      XCTFail(
        "\(key) was not saved as an ordered array, but the array fallback is mandatory here "
          + "because \(reason). Saved as \(saveForm(saved, key)).",
        file: file, line: line)
      return nil
    }
    return entries
  }

  private func agent(tools: [[String: Any]]) throws -> Prompty {
    try Prompty.load([
      "kind": "prompt",
      "name": "save-form",
      "model": ["id": "gpt-4o-mini", "apiType": "chat"],
      "tools": tools,
      "instructions": "user:\nhi",
    ])
  }

  // MARK: - Disqualifying fixtures: the array fallback is mandatory

  /// Two tools sharing a name both survive a save/reload, and the array
  /// fallback is chosen.
  ///
  /// This is the precise defect that withdrew a candidate emitter in another
  /// runtime. The third, uniquely-named tool is present so the collection is
  /// genuinely mixed — a naive implementation that falls back only when *every*
  /// name repeats would still pass a duplicates-only fixture. The two duplicates
  /// carry different descriptions so that a collapse-then-clone implementation,
  /// which restores the count but not the content, still fails.
  func testDuplicateToolNamesSurviveSaveAndReload() throws {
    let loaded = try agent(tools: [
      ["name": "dup", "kind": "function", "description": "first"],
      ["name": "dup", "kind": "function", "description": "second"],
      ["name": "unique", "kind": "function", "description": "third"],
    ])

    XCTAssertEqual(loaded.tools?.count, 3, "the fixture did not load three tools to begin with")

    let saved = try loaded.save()
    guard requireArrayForm(saved, "tools", because: "two tools share the name 'dup'") != nil else {
      return
    }

    let reloaded = try Prompty.load(saved)
    XCTAssertEqual(
      reloaded.tools?.count, 3,
      "duplicate-named tools collapsed on save/reload — saved as \(saveForm(saved, "tools"))")
    XCTAssertEqual(
      toolSignatures(reloaded).sorted(), ["dup|first", "dup|second", "unique|third"],
      "a duplicate-named tool lost or swapped its payload — "
        + "saved as \(saveForm(saved, "tools"))")
  }

  /// The same guarantee for properties, which are a separate collection with
  /// its own save path.
  ///
  /// Asserts `name|default` signatures rather than a bare count, so a
  /// collapse-then-clone implementation that restores the count with the wrong
  /// content still fails.
  func testDuplicatePropertyNamesSurviveSaveAndReload() throws {
    let loaded = try Prompty.load([
      "kind": "prompt",
      "name": "dup-props",
      "model": ["id": "gpt-4o-mini", "apiType": "chat"],
      "inputs": [
        ["name": "dup", "kind": "string", "default": "a"],
        ["name": "dup", "kind": "string", "default": "b"],
        ["name": "unique", "kind": "string", "default": "c"],
      ],
      "instructions": "user:\nhi",
    ])

    XCTAssertEqual(loaded.inputs?.count, 3, "the fixture did not load three inputs to begin with")

    let saved = try loaded.save()
    guard
      let savedEntries = requireArrayForm(
        saved, "inputs", because: "two inputs share the name 'dup'")
    else { return }

    // Assert the *first* serialized output, not only the re-save below. A
    // defect that reverses entries would reverse them once, reload in that
    // order, then reverse them back on the second save — cancelling out and
    // leaving a re-save-only assertion green while the first output violated
    // the canonical order. Any involutive corruption hides the same way.
    XCTAssertEqual(
      propertySignatures(of: savedEntries), ["dup|a", "dup|b", "unique|c"],
      "the first save lost, exchanged or reordered a duplicate-named input's default")

    let reloaded = try Prompty.load(saved)
    XCTAssertEqual(
      reloaded.inputs?.count, 3,
      "duplicate-named inputs collapsed on save/reload — saved as \(saveForm(saved, "inputs"))")

    // Re-save so payload can be compared without switching on the generated
    // Property enum, whose scalar case is the `.unknown` dictionary passthrough.
    // This second check is retained because it catches reload-side corruption
    // that the first-save assertion cannot see.
    let resaved = try reloaded.save()
    guard
      let entries = requireArrayForm(resaved, "inputs", because: "two inputs share the name 'dup'")
    else { return }

    // Declaration order, not a sorted multiset. Both duplicates are named
    // `dup`, so exchanging their defaults leaves the sorted multiset identical
    // and would pass — the association is only observable positionally. Legal
    // to assert here because the array form was required above, and the array
    // fallback is the one representation canonical promises an order for.
    XCTAssertEqual(
      propertySignatures(of: entries), ["dup|a", "dup|b", "unique|c"],
      "a duplicate-named input lost, exchanged or reordered its default across reload")
  }

  /// An empty name is the other disqualifier, and it needs the form assertion
  /// more than the duplicate cases do: JSON permits `""` as an object key, so
  /// an illegal object encoding would round-trip both entries cleanly and pass
  /// every payload assertion. Only checking the form catches it.
  ///
  /// Order is asserted here because the mandatory array form promises it.
  func testEmptyNameForcesTheArrayFallbackAndDropsNothing() throws {
    let loaded = try agent(tools: [
      ["name": "", "kind": "function", "description": "blank"],
      ["name": "named", "kind": "function", "description": "ok"],
    ])

    XCTAssertEqual(loaded.tools?.count, 2, "the fixture did not load two tools to begin with")

    let saved = try loaded.save()
    guard requireArrayForm(saved, "tools", because: "one tool has an empty name") != nil else {
      return
    }

    let reloaded = try Prompty.load(saved)
    XCTAssertEqual(
      reloaded.tools?.count, 2,
      "an empty-named tool was dropped on save/reload — saved as \(saveForm(saved, "tools"))")
    XCTAssertEqual(
      toolSignatures(reloaded), ["|blank", "named|ok"],
      "the empty-named tool lost its name or payload, or the entries were reordered")
  }

  /// The empty-name disqualifier on the `inputs` path.
  ///
  /// `inputs` saves through a different path than `tools`, so each disqualifier
  /// has to be proven on both collections independently — an implementation can
  /// get one right and the other wrong. The duplicate-name case already is;
  /// this closes the empty-name case.
  ///
  /// It is also the disqualifier least likely to be caught by accident. `""` is
  /// a legal JSON object key, so an illegal object encoding round-trips both
  /// entries cleanly and satisfies every payload assertion. Only the form check
  /// rejects it.
  func testEmptyPropertyNameForcesTheArrayFallback() throws {
    let loaded = try Prompty.load([
      "kind": "prompt",
      "name": "empty-name-prop",
      "model": ["id": "gpt-4o-mini", "apiType": "chat"],
      "inputs": [
        ["name": "", "kind": "string", "default": "blank"],
        ["name": "named", "kind": "string", "default": "ok"],
      ],
      "instructions": "user:\nhi",
    ])

    XCTAssertEqual(loaded.inputs?.count, 2, "the fixture did not load two inputs to begin with")

    let saved = try loaded.save()
    guard
      let savedEntries = requireArrayForm(
        saved, "inputs", because: "one input has an empty name")
    else { return }

    // The first serialized output, for the same cancellation reason as the
    // duplicate-name test: an involutive reordering defect would undo itself
    // across the save/reload/save cycle below.
    XCTAssertEqual(
      propertySignatures(of: savedEntries), ["|blank", "named|ok"],
      "the first save lost, exchanged or reordered the empty-named input")

    let reloaded = try Prompty.load(saved)
    XCTAssertEqual(
      reloaded.inputs?.count, 2,
      "an empty-named input was dropped on save/reload — saved as \(saveForm(saved, "inputs"))")

    // Re-save for the same reason as the duplicate-name property test: a scalar
    // `Property` resolves to the `.unknown` passthrough, so the saved
    // dictionary is where the payload is legible. Retained alongside the
    // first-save assertion because it catches reload-side corruption.
    let resaved = try reloaded.save()
    guard
      let entries = requireArrayForm(resaved, "inputs", because: "one input has an empty name")
    else { return }

    XCTAssertEqual(
      propertySignatures(of: entries), ["|blank", "named|ok"],
      "the empty-named input lost its name or default, or the entries were reordered")
  }

  /// Where the array fallback is mandatory, order is part of the contract.
  ///
  /// This fixture has duplicate names, so a conforming emitter *must* choose the
  /// array form. Skipping when it does not would let a defective object-form
  /// selection leave CI green, so the form is asserted rather than tolerated.
  func testArrayFallbackPreservesDeclarationOrder() throws {
    let loaded = try agent(tools: [
      ["name": "dup", "kind": "function", "description": "first"],
      ["name": "dup", "kind": "function", "description": "second"],
      ["name": "aaa_last_alphabetically_first", "kind": "function", "description": "third"],
    ])

    let saved = try loaded.save()
    guard requireArrayForm(saved, "tools", because: "two tools share the name 'dup'") != nil else {
      return
    }

    let reloaded = try Prompty.load(saved)

    // Declaration order, not alphabetical order — the third tool sorts first by
    // name, so an accidental re-sort would move it and fail here.
    XCTAssertEqual(
      toolSignatures(reloaded),
      ["dup|first", "dup|second", "aaa_last_alphabetically_first|third"],
      "the ordered-array fallback did not preserve declaration order")
  }

  // MARK: - Qualifying fixture: either form is legal

  /// Uniquely-named entries survive whichever form is chosen.
  ///
  /// Both forms are legal here, so this asserts survival and payload only. It
  /// deliberately does **not** assert the saved form, and **not** reload order:
  /// the object form makes no ordering promise, so pinning either would fail on
  /// a legal emitter change for a reason unrelated to what this checks. The
  /// names are chosen so declaration order and alphabetical order disagree,
  /// which is what makes an accidental order assertion visible in review.
  func testUniquelyNamedToolsSurviveWhicheverFormIsUsed() throws {
    let loaded = try agent(tools: [
      ["name": "b_tool", "kind": "function", "description": "bee"],
      ["name": "a_tool", "kind": "function", "description": "ay"],
    ])

    let saved = try loaded.save()
    let reloaded = try Prompty.load(saved)

    XCTAssertEqual(
      reloaded.tools?.count, 2,
      "a uniquely-named tool was dropped — saved as \(saveForm(saved, "tools"))")
    XCTAssertEqual(
      toolSignatures(reloaded).sorted(), ["a_tool|ay", "b_tool|bee"],
      "a uniquely-named tool lost or swapped its payload — "
        + "saved as \(saveForm(saved, "tools"))")
  }
}

import XCTest

@testable import Prompty
@testable import PromptyModel

/// How a vector's `bindings` expectation is paired with the loaded bindings.
///
/// `validateBindings` addresses entries by name, which is sound only while
/// those names are unique. An object cannot carry the same key twice, so a
/// repeated name proves the source used the array fallback — the one
/// representation that carries order — and those entries are therefore
/// positional. Uniquely named entries stay order- and representation-agnostic,
/// because both forms are legal for them and object form's order is an
/// artefact of key iteration, not content.
///
/// No spec vector declares a duplicate binding name today, so none of this is
/// reachable through `testLoadVectors`. These tests drive `validateBindings`
/// directly, to pin the rule before PR #447 lands vectors that rely on it —
/// otherwise the first duplicate-bearing vector would be compared by a rule
/// nothing had ever checked.
final class BindingExpectationPairingTests: XCTestCase {

  // MARK: - Fixture

  /// Load a function tool whose bindings are declared in array form, so the
  /// declared order is the loaded order.
  ///
  /// The loaded shape is asserted here rather than assumed: if loading
  /// collapsed the duplicates into a map or reordered the array, every
  /// `XCTAssertThrowsError` below would still pass — for the wrong reason, on a
  /// count mismatch that has nothing to do with pairing.
  private func tool(
    _ bindings: [(name: String, input: String)],
    file: StaticString = #filePath,
    line: UInt = #line
  ) throws -> Tool {
    let loaded = try Tool.load([
      "name": "lookup",
      "kind": "function",
      "bindings": bindings.map { ["name": $0.name, "input": $0.input] },
    ])
    XCTAssertEqual(
      loaded.bindings.map(\.name), bindings.map(\.name),
      "loader did not preserve the declared binding names in order",
      file: file, line: line)
    XCTAssertEqual(
      loaded.bindings.map(\.input), bindings.map(\.input),
      "loader did not preserve the declared binding inputs in order",
      file: file, line: line)
    return loaded
  }

  private func validate(_ tool: Tool, _ bindings: Any) throws {
    try LoadVectorTests.validateBindings(tool, expected: ["bindings": bindings], index: 0)
  }

  // MARK: - Duplicate names are positional

  /// The case name addressing cannot see at all.
  ///
  /// Both expectations carry the same name *and* the same input, so a
  /// `first(where:)` lookup satisfies both from the first entry and never
  /// examines the second — reporting a pass while half the collection went
  /// unverified. Positional comparison reaches it.
  func testDuplicateNamesDoNotLeaveLaterEntriesUnverified() throws {
    let loaded = try tool([("dup", "a"), ("dup", "wrong")])
    XCTAssertThrowsError(
      try validate(
        loaded,
        [
          ["name": "dup", "input": "a"],
          ["name": "dup", "input": "a"],
        ]),
      "the second duplicate entry was never compared")
  }

  /// Duplicates come from the ordered representation, so exchanging the
  /// payloads of two identically named entries is a real difference — not the
  /// reordering of a keyed collection. A multiset comparison would call these
  /// equal.
  func testDuplicateNamesAreComparedPositionallyNotAsAMultiset() throws {
    let loaded = try tool([("dup", "b"), ("dup", "a")])
    XCTAssertThrowsError(
      try validate(
        loaded,
        [
          ["name": "dup", "input": "a"],
          ["name": "dup", "input": "b"],
        ]),
      "exchanged payloads under a repeated name must not compare equal")
  }

  /// Positive control for the two above: the same duplicated shape passes when
  /// the positions do agree, so those failures are pairing-specific rather than
  /// a blanket rejection of duplicate names.
  func testDuplicateNamesPassWhenPositionsAgree() throws {
    let loaded = try tool([("dup", "a"), ("dup", "b")])
    XCTAssertNoThrow(
      try validate(
        loaded,
        [
          ["name": "dup", "input": "a"],
          ["name": "dup", "input": "b"],
        ]))
  }

  // MARK: - Unique names stay agnostic

  /// Unique names must *not* be compared positionally. Object form is legal for
  /// them and its order is an artefact, so asserting position here would reject
  /// a conforming loader.
  func testUniqueNamesStayOrderAgnosticInListForm() throws {
    let loaded = try tool([("b", "2"), ("a", "1")])
    XCTAssertNoThrow(
      try validate(
        loaded,
        [
          ["name": "a", "input": "1"],
          ["name": "b", "input": "2"],
        ]))
  }

  /// Guards the test above from vacuity: order-agnostic must not mean
  /// value-blind.
  func testUniqueNamesStillCatchAWrongInput() throws {
    let loaded = try tool([("b", "2"), ("a", "wrong")])
    XCTAssertThrowsError(
      try validate(
        loaded,
        [
          ["name": "a", "input": "1"],
          ["name": "b", "input": "2"],
        ]),
      "a wrong input must fail even though the names all match")
  }

  /// Map expectations address by key, so they are order-agnostic for the same
  /// reason — and cannot express duplicates at all.
  func testMapFormStaysOrderAgnostic() throws {
    let loaded = try tool([("b", "2"), ("a", "1")])
    XCTAssertNoThrow(
      try validate(loaded, ["a": ["input": "1"], "b": ["input": "2"]]))
  }

  /// The positional branch must compare names, not only inputs. Every entry
  /// here carries the same input, so only the name comparison can see that two
  /// entries changed places.
  func testPositionalComparisonChecksNamesNotJustInputs() throws {
    let loaded = try tool([("dup", "same"), ("dup", "same"), ("unique", "same")])
    XCTAssertThrowsError(
      try validate(
        loaded,
        [
          ["name": "dup", "input": "same"],
          ["name": "unique", "input": "same"],
          ["name": "dup", "input": "same"],
        ]),
      "a name moved between positions must be caught even when inputs match")
  }

  // MARK: - Empty names are positional too

  /// An empty name disqualifies object form exactly as a duplicate does, so it
  /// equally proves the source was the ordered array fallback — even though
  /// every name here is unique, and so would pass a uniqueness-only pre-scan
  /// while the array had been reordered.
  func testEmptyNameForcesPositionalComparison() throws {
    let loaded = try tool([("named", "ok"), ("", "blank")])
    XCTAssertThrowsError(
      try validate(
        loaded,
        [
          ["name": "", "input": "blank"],
          ["name": "named", "input": "ok"],
        ]),
      "an empty name makes the collection ordered, so the reorder must be caught")
  }

  /// Positive control for the above: an empty name is not rejected outright,
  /// only held to its position.
  func testEmptyNamePassesWhenPositionsAgree() throws {
    let loaded = try tool([("", "blank"), ("named", "ok")])
    XCTAssertNoThrow(
      try validate(
        loaded,
        [
          ["name": "", "input": "blank"],
          ["name": "named", "input": "ok"],
        ]))
  }

  /// Object form cannot legally carry an empty key, so a map expectation that
  /// does is malformed rather than something to address by name.
  func testMapFormRejectsAnEmptyKey() throws {
    let loaded = try tool([("", "blank")])
    XCTAssertThrowsError(
      try validate(loaded, ["": ["input": "blank"]]),
      "an empty key cannot be expressed in object form")
  }
}

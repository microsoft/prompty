import Foundation

import PromptyModel

import XCTest

/// Acceptance gate for inherited-field data loss on composite `Property` subtypes.
///
/// `ArrayProperty`, `ObjectProperty` and `UnionProperty` all `extends Property`
/// in `schema/model/core/properties.tsp`, so each inherits six fields:
/// `description`, `required`, `nullable`, `default`, `example` and `enumValues`.
/// A seventh, `name`, arrives through the `Named<Property>` alias rather than
/// through `extends`, but the emitter drops it the same way, so it is guarded
/// alongside them. @typra/emitter drops these fields from derived Swift structs,
/// which loses the values *silently* — the code compiles and the data just
/// disappears. `schema/scripts/patch-swift-emitter-defects.mjs` injects them
/// back into the stored properties, `load` and `save`.
///
/// `GeneratedModelRoundTripTests` already covers the in-memory `load` → `save`
/// pair for these subtypes. This file extends that guarantee to the axes the
/// shared spec vectors never reach: JSON and YAML text round trips, values
/// constructed in Swift rather than parsed, non-scalar values in `default` /
/// `example` / `enumValues`, and inherited fields on nested branches.
///
/// These tests are meant to survive the emitter fix: they assert the required
/// *behaviour*, not the shim. They deliberately avoid whole-dictionary equality,
/// because a corrected emitter may legitimately start materializing schema
/// defaults (`required: false`, `enumValues: []`) that a strict key-count
/// comparison would reject for reasons unrelated to this defect.
///
/// Known residual gap, deliberately not asserted here: the shim restores base
/// fields to the stored properties but not to the generated memberwise `init`,
/// which only the emitter can do. Callers must therefore construct a composite
/// subtype and then assign inherited fields, as
/// `testInheritedFieldsSurviveProgrammaticConstruction` does. The shim's
/// `assertPinnedEmitterVersion()` already fails the build on any emitter version
/// change, so that gap gets re-audited without a canary test here.
@testable import Prompty

final class InheritedPropertyFieldTests: XCTestCase {

  /// Every field `Property` passes down to its composite subtypes.
  private static let inheritedFields = [
    "name", "description", "required", "nullable", "default", "example", "enumValues",
  ]

  /// The discriminator-specific payload each composite subtype requires,
  /// keyed by `kind`.
  private static let compositePayloads: [String: [String: Any]] = [
    "array": ["items": ["name": "item", "kind": "string"]],
    "object": ["properties": [["name": "child", "kind": "string"]]],
    "union": ["oneOf": [["name": "branch", "kind": "string"]]],
  ]

  /// A composite property carrying a value for every inherited field.
  private static func source(kind: String, extra: [String: Any] = [:]) -> [String: Any] {
    var source: [String: Any] = [
      "name": "field_\(kind)",
      "kind": kind,
      "description": "an inherited description on a \(kind) property",
      "required": true,
      "nullable": true,
      "default": "default_\(kind)",
      "example": "example_\(kind)",
      "enumValues": ["one", "two"],
    ]
    source.merge(compositePayloads[kind] ?? [:]) { current, _ in current }
    source.merge(extra) { _, replacement in replacement }
    return source
  }

  /// Assert every inherited field in `expected` survived into `actual`.
  private func assertInheritedFieldsPreserved(
    _ actual: [String: Any],
    _ expected: [String: Any],
    _ label: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    for key in Self.inheritedFields {
      XCTAssertTrue(
        Spec.equal(actual[key], expected[key]),
        """
        \(label) lost inherited field '\(key)': \
        got \(Spec.describe(actual[key])), expected \(Spec.describe(expected[key]))
        """,
        file: file,
        line: line
      )
    }
  }

  // MARK: - Serialized round trips

  /// JSON text is how a `.prompty` frontmatter property reaches other runtimes,
  /// so inherited fields must survive the encode/decode pair — not just the
  /// in-memory `load`/`save` pair the sibling suite covers.
  func testInheritedFieldsSurviveJSONTextRoundTrip() throws {
    for kind in Self.compositePayloads.keys.sorted() {
      let source = Self.source(kind: kind)
      let json = try Property.load(source).toJSON()
      let saved = try Property.fromJSON(json).save()
      assertInheritedFieldsPreserved(saved, source, "\(kind) property (JSON)")
    }
  }

  /// YAML is the on-disk frontmatter format, so it needs the same guarantee.
  func testInheritedFieldsSurviveYAMLTextRoundTrip() throws {
    for kind in Self.compositePayloads.keys.sorted() {
      let source = Self.source(kind: kind)
      let yaml = try Property.load(source).toYAML()
      let saved = try Property.fromYAML(yaml).save()
      assertInheritedFieldsPreserved(saved, source, "\(kind) property (YAML)")
    }
  }

  /// Repeated round trips must reach a fixed point. A subtype that drops an
  /// inherited field only on the second pass would still look correct to a
  /// single-pass assertion. Each pass is compared against the previous pass in
  /// full, so drift in *any* field is caught, not just the inherited ones.
  func testInheritedFieldsAreStableAcrossRepeatedRoundTrips() throws {
    for kind in Self.compositePayloads.keys.sorted() {
      let source = Self.source(kind: kind)
      var previous = try Property.load(source).save()
      assertInheritedFieldsPreserved(previous, source, "\(kind) property (pass 0)")

      for pass in 1...3 {
        let saved = try Property.load(previous).save()
        assertInheritedFieldsPreserved(saved, source, "\(kind) property (pass \(pass))")
        XCTAssertTrue(
          Spec.equal(saved, previous),
          """
          \(kind) property drifted on pass \(pass): \
          got \(Spec.describe(saved)), previous pass was \(Spec.describe(previous))
          """
        )
        previous = saved
      }
    }
  }

  // MARK: - Programmatic construction

  /// Values set on a Swift-constructed subtype must reach the wire. This is the
  /// axis the memberwise-`init` gap sits on: if the emitter drops the stored
  /// properties again, these assignments stop compiling instead of silently
  /// vanishing, which is the failure mode we want.
  func testInheritedFieldsSurviveProgrammaticConstruction() throws {
    var array = ArrayProperty(items: .unknown(["name": "item", "kind": "string"]))
    array.name = "built_array"
    array.description = "built in Swift"
    array.required = true
    array.nullable = true
    array.default = "fallback"
    array.example = "sample"
    array.enumValues = ["one", "two"]

    var object = ObjectProperty(properties: [.unknown(["name": "child", "kind": "string"])])
    object.name = "built_object"
    object.description = "built in Swift"
    object.required = true
    object.nullable = true
    object.default = "fallback"
    object.example = "sample"
    object.enumValues = ["one", "two"]

    var union = UnionProperty(oneOf: [.unknown(["name": "branch", "kind": "string"])])
    union.name = "built_union"
    union.description = "built in Swift"
    union.required = true
    union.nullable = true
    union.default = "fallback"
    union.example = "sample"
    union.enumValues = ["one", "two"]

    let cases: [(String, [String: Any])] = [
      ("array", try array.save()),
      ("object", try object.save()),
      ("union", try union.save()),
    ]

    for (kind, saved) in cases {
      let expected = Self.source(
        kind: kind,
        extra: [
          "name": "built_\(kind)",
          "description": "built in Swift",
          "default": "fallback",
          "example": "sample",
        ]
      )
      assertInheritedFieldsPreserved(saved, expected, "constructed \(kind) property")

      // And the constructed value must survive a reload unchanged.
      let reloaded = try Property.load(saved).save()
      assertInheritedFieldsPreserved(reloaded, expected, "reloaded \(kind) property")
    }
  }

  // MARK: - Non-scalar inherited values

  /// The shared spec vectors only ever put scalars in `default` / `example` /
  /// `enumValues`. Composite subtypes are exactly where structured values show
  /// up in practice, so exercise them explicitly.
  func testNonScalarInheritedValuesSurviveRoundTrip() throws {
    let structured: [String: Any] = [
      "default": ["nested": ["deep": [1, 2, 3]], "flag": true],
      "example": [["id": 1, "label": "first"], ["id": 2, "label": "second"]],
      "enumValues": [["tier": "gold"], ["tier": "silver"]],
    ]

    for kind in Self.compositePayloads.keys.sorted() {
      let source = Self.source(kind: kind, extra: structured)

      let saved = try Property.load(source).save()
      assertInheritedFieldsPreserved(saved, source, "\(kind) property (structured)")

      // Structured values must survive serialization too, not just the
      // dictionary path — JSON is where type coercion tends to flatten them.
      let json = try Property.load(source).toJSON()
      let decoded = try Property.fromJSON(json).save()
      assertInheritedFieldsPreserved(decoded, source, "\(kind) property (structured, JSON)")
    }
  }

  // MARK: - Nested composites

  /// Object children each carry their own inherited fields. A subtype that only
  /// restored base fields at the top level would pass every other test here.
  func testInheritedFieldsSurviveOnNestedObjectChildren() throws {
    let source: [String: Any] = [
      "name": "envelope",
      "kind": "object",
      "description": "outer",
      "required": true,
      "properties": [
        [
          "name": "inner_array",
          "kind": "array",
          "description": "a nested array",
          "required": true,
          "nullable": true,
          "default": ["seeded"],
          "example": ["sampled"],
          "enumValues": ["one", "two"],
          "items": ["name": "cell", "kind": "string", "description": "a cell", "required": true],
        ]
      ],
    ]

    let property = try Property.load(source)
    let child = try XCTUnwrap(property.objectProperties.first)

    XCTAssertEqual(child.name, "inner_array")
    XCTAssertEqual(child.propertyDescription, "a nested array")
    XCTAssertTrue(child.isRequired)
    XCTAssertTrue(child.isNullable)
    XCTAssertEqual(child.arrayItems?.propertyDescription, "a cell")

    // Assert the child's inherited fields on the saved payload rather than
    // comparing whole dictionaries, so newly-materialized schema defaults from
    // a corrected emitter don't fail this for the wrong reason.
    let saved = try property.save()
    assertInheritedFieldsPreserved(saved, source, "outer object property")

    let savedChildren = try XCTUnwrap(
      saved["properties"] as? [Any], "outer object lost its 'properties' entirely")
    let savedChild = try XCTUnwrap(savedChildren.first as? [String: Any])
    let expectedChild = try XCTUnwrap(
      (source["properties"] as? [Any])?.first as? [String: Any])
    assertInheritedFieldsPreserved(savedChild, expectedChild, "nested array child")

    let savedItems = try XCTUnwrap(
      savedChild["items"] as? [String: Any], "nested array child lost its 'items'")
    let expectedItems = try XCTUnwrap(expectedChild["items"] as? [String: Any])
    assertInheritedFieldsPreserved(savedItems, expectedItems, "nested array item")
  }

  /// Union branches are properties in their own right, so each branch must keep
  /// its inherited fields through a round trip. `oneOf` and `anyOf` are separate
  /// generated fields and are checked separately.
  func testInheritedFieldsSurviveOnUnionBranches() throws {
    let branch: [String: Any] = [
      "name": "branch",
      "kind": "array",
      "description": "a union branch",
      "required": true,
      "nullable": true,
      "default": ["seeded"],
      "example": ["sampled"],
      "enumValues": ["one", "two"],
      "items": ["name": "item", "kind": "string", "description": "an item"],
    ]

    for composition in ["oneOf", "anyOf"] {
      let source: [String: Any] = [
        "name": "choice",
        "kind": "union",
        "description": "outer union",
        "required": true,
        composition: [branch],
      ]

      let saved = try Property.load(source).save()
      assertInheritedFieldsPreserved(saved, source, "outer union ('\(composition)')")

      let branches = try XCTUnwrap(
        saved[composition] as? [Any],
        "union lost its '\(composition)' branches entirely"
      )
      let first = try XCTUnwrap(branches.first as? [String: Any])
      assertInheritedFieldsPreserved(first, branch, "union '\(composition)' branch")

      // The branch's own nested item must keep its inherited fields too.
      let items = try XCTUnwrap(
        first["items"] as? [String: Any], "union '\(composition)' branch lost its 'items'")
      let expectedItems = try XCTUnwrap(branch["items"] as? [String: Any])
      assertInheritedFieldsPreserved(items, expectedItems, "union '\(composition)' branch item")

      // Only the populated composition field may be emitted.
      let other = composition == "oneOf" ? "anyOf" : "oneOf"
      XCTAssertNil(saved[other], "union emitted '\(other)' alongside '\(composition)'")
    }
  }

  /// A composite nested inside a composite — three levels of the recursive
  /// `Property` shape. `Property` nests without limit, so this is a
  /// representative depth, not an exhaustive one; it guards against a fix that
  /// only walks one level down.
  func testInheritedFieldsSurviveDeeplyNestedComposites() throws {
    let source: [String: Any] = [
      "name": "rows",
      "kind": "array",
      "description": "outer array",
      "required": true,
      "items": [
        "name": "row",
        "kind": "object",
        "description": "a row",
        "nullable": true,
        "properties": [
          [
            "name": "values",
            "kind": "union",
            "description": "a cell value",
            "required": true,
            "enumValues": ["one", "two"],
            "anyOf": [
              ["name": "as_text", "kind": "string", "description": "text form", "required": true]
            ],
          ]
        ],
      ],
    ]

    let property = try Property.load(source)
    let row = try XCTUnwrap(property.arrayItems)
    XCTAssertEqual(row.propertyDescription, "a row")
    XCTAssertTrue(row.isNullable)

    let cell = try XCTUnwrap(row.objectProperties.first)
    XCTAssertEqual(cell.propertyDescription, "a cell value")
    XCTAssertTrue(cell.isRequired)
    XCTAssertTrue(Spec.equal(cell.enumValues, ["one", "two"]))

    // Walk the saved payload level by level, asserting inherited fields at each
    // depth instead of comparing whole dictionaries.
    let saved = try property.save()
    assertInheritedFieldsPreserved(saved, source, "level 1 (array)")

    let savedRow = try XCTUnwrap(saved["items"] as? [String: Any], "level 1 lost 'items'")
    let expectedRow = try XCTUnwrap(source["items"] as? [String: Any])
    assertInheritedFieldsPreserved(savedRow, expectedRow, "level 2 (object)")

    let savedCell = try XCTUnwrap(
      (savedRow["properties"] as? [Any])?.first as? [String: Any], "level 2 lost 'properties'")
    let expectedCell = try XCTUnwrap((expectedRow["properties"] as? [Any])?.first as? [String: Any])
    assertInheritedFieldsPreserved(savedCell, expectedCell, "level 3 (union)")

    let savedBranch = try XCTUnwrap(
      (savedCell["anyOf"] as? [Any])?.first as? [String: Any], "level 3 lost 'anyOf'")
    let expectedBranch = try XCTUnwrap((expectedCell["anyOf"] as? [Any])?.first as? [String: Any])
    assertInheritedFieldsPreserved(savedBranch, expectedBranch, "level 4 (union branch)")
  }

  // MARK: - Falsy and explicitly-null inherited values

  /// Inherited fields set to their *default-looking* values must still survive.
  /// `save()` guards each field differently — `name` is dropped when empty while
  /// `required` is emitted whenever non-nil — so a field carrying `false`, `""`
  /// or `[]` is the case most likely to be quietly discarded.
  func testFalsyInheritedValuesSurviveRoundTrip() throws {
    for kind in Self.compositePayloads.keys.sorted() {
      let source = Self.source(
        kind: kind,
        extra: [
          "required": false,
          "nullable": false,
          "default": "",
          "example": 0,
          "enumValues": [],
        ]
      )

      let saved = try Property.load(source).save()
      for key in ["required", "nullable", "default", "example", "enumValues"] {
        XCTAssertNotNil(saved[key], "\(kind) property dropped falsy inherited field '\(key)'")
        XCTAssertTrue(
          Spec.equal(saved[key], source[key]),
          """
          \(kind) property corrupted falsy inherited field '\(key)': \
          got \(Spec.describe(saved[key])), expected \(Spec.describe(source[key]))
          """
        )
      }
    }
  }

  /// Structured values must survive YAML as well as JSON — YAML is the on-disk
  /// frontmatter format, and block/flow collection handling is a separate code
  /// path from JSON encoding.
  func testNonScalarInheritedValuesSurviveYAMLRoundTrip() throws {
    let structured: [String: Any] = [
      "default": ["nested": ["deep": [1, 2, 3]], "flag": true],
      "example": [["id": 1, "label": "first"], ["id": 2, "label": "second"]],
      "enumValues": [["tier": "gold"], ["tier": "silver"]],
    ]

    for kind in Self.compositePayloads.keys.sorted() {
      let source = Self.source(kind: kind, extra: structured)
      let yaml = try Property.load(source).toYAML()
      let saved = try Property.fromYAML(yaml).save()
      assertInheritedFieldsPreserved(saved, source, "\(kind) property (structured, YAML)")
    }
  }
}

import Foundation

import PromptyModel

import XCTest

/// Measures how the generated `Property` enum dispatches every `kind` the
/// schema declares, including the scalar shorthands that `@coerce` defines.
///
/// `schema/model/core/properties.tsp` declares `Property` as the
/// `@discriminator("kind")` base and gives it four `@coerce` forms:
///
/// ```tsp
/// @coerce(string,  #{ kind: "string",  example: "{value}" }, "input", ...)
/// @coerce(integer, #{ kind: "integer", example: "{value}" }, "input", ..., 4)
/// @coerce(float32, #{ kind: "float",   example: "{value}" }, "input", ...)
/// @coerce(boolean, #{ kind: "boolean", example: "{value}" }, "input", ...)
/// ```
///
/// Only `array`, `object` and `union` are separate models that `extends
/// Property`. The scalar kinds are the base model itself, and a bare scalar
/// is meant to coerce into it — `"Doe"` becomes `kind: "string"`, `example:
/// "Doe"`.
///
/// @typra/emitter@0.4.2 emits neither half of that contract: the generated
/// enum carries only the three `extends` subtypes plus `.unknown`, and
/// `Property.load` calls `TypraRuntime.object` before it reads the
/// discriminator, so a bare scalar cannot be loaded at all. Scalar-kind
/// objects therefore land in `.unknown` and bare scalars throw.
///
/// This matters well beyond the model package: `kind: string` is how ordinary
/// prompt inputs are declared, and the cross-runtime vectors under `spec/`
/// use the scalar kinds in 84 places. `.unknown` round-trips its payload
/// verbatim, so the vectors still pass and nothing fails loudly — which is
/// exactly why the gap needs a test that states it.
///
/// These are characterization tests. When a fixed emitter lands scalar
/// dispatch, the two tripwires below fail on purpose. At that point treat
/// every `Property` consumer as suspect — `ModelExtensions.boundParameterNames`
/// and `PromptyOpenAI.Wire` both switch over these cases — then replace the
/// characterizations with the real assertions named in each message.
final class PropertyKindDispatchTests: XCTestCase {

  /// The scalar kinds, paired with the bare literal each one coerces from.
  private static let scalarKinds: [(kind: String, literal: Any)] = [
    ("string", "Doe"),
    ("integer", 4),
    ("float", Double(3.5)),
    ("boolean", true),
  ]

  // MARK: - Structural kinds

  /// `array` / `object` / `union` are real subtypes and must resolve to their
  /// typed cases. This is the control: it proves the discriminator switch
  /// works, so a `.unknown` result below is a missing case rather than a
  /// broken dispatch.
  func testStructuralPropertyKindsDispatchToTypedCases() throws {
    let structural: [String: [String: Any]] = [
      "array": ["items": ["name": "item", "kind": "string"]],
      "object": ["properties": [["name": "child", "kind": "string"]]],
      "union": ["anyOf": [["name": "branch", "kind": "string"]]],
    ]

    for (kind, extra) in structural {
      var source: [String: Any] = ["name": "field_\(kind)", "kind": kind]
      for (key, value) in extra { source[key] = value }

      let loaded = try Property.load(source)
      switch (kind, loaded) {
      case ("array", .arrayProperty), ("object", .objectProperty),
        ("union", .unionProperty):
        break
      default:
        XCTFail("\(kind) did not dispatch to its typed case, got \(loaded)")
        continue
      }

      let saved = try loaded.save()
      XCTAssertEqual(saved["kind"] as? String, kind, "\(kind): discriminator lost")
    }
  }

  // MARK: - Scalar kinds (tripwire)

  /// A scalar `kind` currently has no case of its own, so it falls through to
  /// `.unknown`. The payload survives verbatim, which is why this is invisible
  /// in the spec vectors.
  func testScalarPropertyKindsFallThroughToUnknown() throws {
    for (kind, _) in Self.scalarKinds {
      let source: [String: Any] = [
        "name": "field_\(kind)",
        "kind": kind,
        "description": "a \(kind) input",
      ]

      let loaded = try Property.load(source)
      guard case .unknown(let raw) = loaded else {
        XCTFail(
          "\(kind) now dispatches to a typed case — the emitter grew scalar "
            + "support. Re-audit every `Property` switch (ModelExtensions, "
            + "PromptyOpenAI.Wire), then assert the typed case here instead")
        continue
      }

      // Verbatim preservation is the only reason the vectors stay green.
      XCTAssertEqual(raw["kind"] as? String, kind, "\(kind): discriminator lost")
      XCTAssertEqual(raw["name"] as? String, "field_\(kind)", "\(kind): name lost")
      XCTAssertEqual(
        raw["description"] as? String, "a \(kind) input", "\(kind): description lost")

      let saved = try loaded.save()
      XCTAssertEqual(saved["kind"] as? String, kind, "\(kind): discriminator lost on save")
      XCTAssertEqual(saved["name"] as? String, "field_\(kind)", "\(kind): name lost on save")
    }
  }

  // MARK: - @coerce shorthand

  /// The `@coerce` shorthand IS emitted at the current emitter version:
  /// `Property.load` normalizes a bare scalar into
  /// `#{ kind: <scalar-type>, example: <value> }` before it inspects the
  /// discriminator. Scalar kinds (`string`/`integer`/`float`/`boolean`) are not
  /// modeled subtypes, so the coerced object resolves to the open `.unknown`
  /// case carrying that `{ kind, example }` payload verbatim.
  func testBareScalarShorthandIsCoerced() throws {
    for (kind, literal) in Self.scalarKinds {
      let loaded = try Property.load(literal)
      guard case .unknown(let raw) = loaded else {
        XCTFail(
          "\(kind): bare scalar should coerce to an unknown-kind Property carrying {kind, example}")
        continue
      }
      XCTAssertEqual(raw["kind"] as? String, kind, "\(kind): coerced kind mismatch")
      switch kind {
      case "string": XCTAssertEqual(raw["example"] as? String, literal as? String)
      case "integer": XCTAssertEqual(raw["example"] as? Int, literal as? Int)
      case "float": XCTAssertEqual(raw["example"] as? Double, literal as? Double)
      case "boolean": XCTAssertEqual(raw["example"] as? Bool, literal as? Bool)
      default: XCTFail("\(kind): unexpected scalar kind")
      }
    }
  }
}

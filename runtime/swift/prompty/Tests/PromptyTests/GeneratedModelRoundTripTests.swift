import Foundation

import PromptyModel

import XCTest

/// Guards the fields `schema/scripts/patch-swift-emitter-defects.mjs` restores.
///
/// @typra/emitter@0.4.2 drops `extends` base-model fields from derived Swift
/// structs, so `ArrayProperty` / `ObjectProperty` / `UnionProperty` and every
/// `Tool` subtype silently lose data on load and save. The shim injects them
/// back. These tests fail loudly if that regresses — including if a future
/// emitter release fixes the defect differently.
@testable import Prompty

final class GeneratedModelRoundTripTests: XCTestCase {

  // MARK: - Property subtypes

  /// Every base `Property` field must survive `load` → `save` on each subtype.
  func testPropertyBaseFieldsRoundTripOnEverySubtype() throws {
    let subtypes: [String: [String: Any]] = [
      "array": ["items": ["name": "item", "kind": "string"]],
      "object": ["properties": [["name": "child", "kind": "string"]]],
      "union": ["anyOf": [["name": "a", "kind": "string"]]],
    ]

    for (kind, extra) in subtypes {
      var source: [String: Any] = [
        "name": "field_\(kind)",
        "kind": kind,
        "description": "a \(kind) property",
        "required": true,
        "nullable": true,
        "default": ["seeded"],
        "example": ["sampled"],
        "enumValues": ["one", "two"],
      ]
      source.merge(extra) { current, _ in current }

      let property = try Property.load(source)
      let saved = try property.save()

      for key in [
        "name", "description", "required", "nullable", "default", "example", "enumValues",
      ] {
        XCTAssertTrue(
          Spec.equal(saved[key], source[key]),
          "\(kind) property lost '\(key)': got \(Spec.describe(saved[key])), expected \(Spec.describe(source[key]))"
        )
      }
    }
  }

  /// The runtime reads base fields through `Property.raw`, so accessors must
  /// see them too — not just the saved dictionary.
  func testPropertyAccessorsSeeBaseFields() throws {
    let property = try Property.load([
      "name": "choices",
      "kind": "array",
      "description": "pick one",
      "required": true,
      "nullable": true,
      "items": ["name": "item", "kind": "string"],
    ])

    XCTAssertEqual(property.name, "choices")
    XCTAssertEqual(property.kindName, "array")
    XCTAssertEqual(property.propertyDescription, "pick one")
    XCTAssertTrue(property.isRequired)
    XCTAssertTrue(property.isNullable)
    XCTAssertEqual(property.arrayItems?.kindName, "string")
  }

  /// Nested subtypes must round-trip too — this is the case that motivated
  /// marking the generated `Property` enum `indirect`.
  func testNestedPropertySubtypesRoundTrip() throws {
    let source: [String: Any] = [
      "name": "matrix",
      "kind": "array",
      "items": [
        "name": "row",
        "kind": "array",
        "items": ["name": "cell", "kind": "integer", "description": "a cell"],
      ],
    ]

    let property = try Property.load(source)
    XCTAssertEqual(property.arrayItems?.name, "row")
    XCTAssertEqual(property.arrayItems?.arrayItems?.name, "cell")
    XCTAssertEqual(property.arrayItems?.arrayItems?.propertyDescription, "a cell")
    XCTAssertTrue(Spec.equal(try property.save(), source))
  }

  // MARK: - Tool subtypes

  /// Every `Tool` subtype must retain the base `name` / `description`.
  func testToolBaseFieldsRoundTripOnEverySubtype() throws {
    let subtypes: [[String: Any]] = [
      ["kind": "function", "parameters": [["name": "city", "kind": "string"]]],
      ["kind": "mcp", "serverName": "files"],
      ["kind": "openapi", "specification": "./api.json"],
      ["kind": "prompty", "path": "./child.prompty"],
      // Unknown kinds fall through to the wildcard CustomTool case.
      ["kind": "vendor_specific"],
    ]

    for extra in subtypes {
      var source: [String: Any] = [
        "name": "tool_\(extra["kind"] as? String ?? "?")",
        "description": "a tool",
      ]
      source.merge(extra) { current, _ in current }

      let tool = try Tool.load(source)
      XCTAssertEqual(tool.name, source["name"] as? String, "tool lost 'name'")
      XCTAssertEqual(tool.toolDescription, "a tool", "tool lost 'description'")

      let saved = try tool.save()
      XCTAssertTrue(
        Spec.equal(saved["name"], source["name"]),
        "\(source["kind"] ?? "?") tool did not save 'name'")
      XCTAssertTrue(
        Spec.equal(saved["description"], source["description"]),
        "\(source["kind"] ?? "?") tool did not save 'description'")
    }
  }

  /// Bindings arrive either as a `Record<Binding>` map — where the key supplies
  /// the binding name — or as an already-named list. Both must load.
  func testToolBindingsLoadFromMapForm() throws {
    let tool = try Tool.load([
      "name": "lookup",
      "kind": "function",
      "parameters": [
        ["name": "query", "kind": "string"],
        ["name": "tenant", "kind": "string"],
      ],
      "bindings": [
        "tenant": ["value": "contoso"],
        "apiKey": ["value": "secret"],
      ],
    ])

    // Map keys are sorted so generation stays deterministic.
    XCTAssertEqual(Self.bindingNames(tool), ["apiKey", "tenant"])
    XCTAssertEqual(tool.boundParameterNames, ["apiKey", "tenant"])
  }

  func testToolBindingsLoadFromListForm() throws {
    let tool = try Tool.load([
      "name": "lookup",
      "kind": "function",
      "bindings": [
        ["name": "tenant", "value": "contoso"]
      ],
    ])

    XCTAssertEqual(Self.bindingNames(tool), ["tenant"])
    XCTAssertEqual(tool.boundParameterNames, ["tenant"])
  }

  // MARK: - Wildcard cases

  /// `Tool` and `Connection` both need a wildcard case so unknown kinds survive
  /// a round trip instead of throwing.
  func testUnknownToolKindRoundTrips() throws {
    let source: [String: Any] = [
      "name": "vendor_tool",
      "kind": "vendor.custom",
      "options": ["setting": "value"],
    ]
    let saved = try Tool.load(source).save()
    XCTAssertTrue(
      Spec.equal(saved["kind"], "vendor.custom"), "unknown tool kind was not preserved")
    XCTAssertTrue(Spec.equal(saved["name"], "vendor_tool"))
  }

  func testUnknownConnectionKindRoundTrips() throws {
    let source: [String: Any] = ["kind": "vendor.auth", "endpoint": "https://example.test"]
    let saved = try Connection.load(source).save()
    XCTAssertTrue(Spec.equal(saved, source), "unknown connection kind was not preserved")
  }

  /// Characterizes a base-field gap the shim deliberately leaves open.
  ///
  /// `model Connection` declares `authenticationMode` and `usageDescription`
  /// (`schema/model/connection/connection.tsp`), and every subtype `extends`
  /// it — so the emitter defect that drops `Property` / `Tool` base fields
  /// drops these too. The shim does not inject them; see the Defect 10 scope
  /// note in `schema/scripts/patch-swift-emitter-defects.mjs`.
  ///
  /// The cost is real even though no runtime code reads the fields: both are
  /// lost between `load` and `save` with zero compile diagnostics, which is
  /// precisely the failure mode this file exists to catch. Covering all six
  /// subtypes keeps the gap measured rather than assumed, and makes the test
  /// fail if either field starts surviving — at which point re-audit the
  /// emitter and this shim, then assert preservation instead.
  func testConnectionBaseFieldsAreDroppedOnEverySubtype() throws {
    let subtypes: [(kind: String, declared: [String: String])] = [
      ("reference", ["name": "my-connection", "target": "some-target"]),
      ("remote", ["name": "my-connection", "endpoint": "https://example.test"]),
      ("key", ["endpoint": "https://example.test", "apiKey": "secret"]),
      ("anonymous", ["endpoint": "https://example.test"]),
      ("oauth", ["endpoint": "https://example.test", "clientId": "client-id"]),
      ("foundry", ["endpoint": "https://example.test", "name": "my-connection"]),
    ]

    for (kind, declared) in subtypes {
      var source: [String: Any] = ["kind": kind]
      for (key, value) in declared { source[key] = value }
      source["authenticationMode"] = "system"
      source["usageDescription"] = "respond to email on your behalf"

      let loaded = try Connection.load(source)
      // `.unknown` preserves its payload verbatim, so the assertions below
      // would pass for the wrong reason if a discriminator stopped resolving.
      if case .unknown = loaded {
        XCTFail("\(kind) fell through to .unknown instead of its subtype")
        continue
      }

      let saved = try loaded.save()
      XCTAssertEqual(saved["kind"] as? String, kind, "\(kind): discriminator lost")
      for (key, value) in declared {
        XCTAssertEqual(saved[key] as? String, value, "\(kind): declared field \(key) lost")
      }

      XCTAssertNil(
        saved["authenticationMode"],
        "\(kind): authenticationMode now survives — re-audit the emitter and the "
          + "shim, then replace this characterization with a preservation assertion")
      XCTAssertNil(
        saved["usageDescription"],
        "\(kind): usageDescription now survives — re-audit the emitter and the "
          + "shim, then replace this characterization with a preservation assertion")
    }
  }

  // MARK: - Helpers

  /// Read binding names off the loaded tool, which the generated `Tool` enum
  /// exposes only through its raw payload.
  private static func bindingNames(_ tool: Tool) -> [String]? {
    guard let bindings = tool.raw["bindings"] as? [Any] else { return nil }
    return bindings.compactMap { ($0 as? [String: Any])?["name"] as? String }
  }

  // MARK: - Convenience factories

  /// The emitter's factories built messages from raw literals; the shim makes
  /// them construct real enum values.
  func testMessageFactoriesProduceTypedValues() {
    let assistant = Message.assistant(text: "hi")
    XCTAssertEqual(assistant.role.rawValue, "assistant")
    XCTAssertEqual(assistant.textContent, "hi")

    let user = Message.user(text: "hello")
    XCTAssertEqual(user.role.rawValue, "user")
    XCTAssertEqual(user.textContent, "hello")

    let system = Message.system(text: "be helpful")
    XCTAssertEqual(system.role.rawValue, "system")
    XCTAssertEqual(system.textContent, "be helpful")
  }
}

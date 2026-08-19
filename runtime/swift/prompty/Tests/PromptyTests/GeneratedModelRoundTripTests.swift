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
    // mcp/openapi and the wildcard CustomTool all carry a required `connection`.
    let connection: [String: Any] = [
      "kind": "key",
      "endpoint": "https://example.test",
      "apiKey": "x",
    ]
    let subtypes: [[String: Any]] = [
      ["kind": "function", "parameters": [["name": "city", "kind": "string"]]],
      ["kind": "mcp", "serverName": "files", "connection": connection],
      ["kind": "openapi", "specification": "./api.json", "connection": connection],
      // Unknown kinds fall through to the wildcard CustomTool case.
      ["kind": "vendor_specific", "connection": connection],
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

  // MARK: - Wildcard / closed-union cases

  /// `Tool` is an open union: an unknown kind survives a round trip through the
  /// wildcard `CustomTool` case instead of throwing. `CustomTool` still carries
  /// a required `connection`, so the fixture supplies one.
  func testUnknownToolKindRoundTrips() throws {
    let source: [String: Any] = [
      "name": "vendor_tool",
      "kind": "vendor.custom",
      "connection": ["kind": "key", "endpoint": "https://example.test", "apiKey": "x"],
      "options": ["setting": "value"],
    ]
    let saved = try Tool.load(source).save()
    XCTAssertTrue(
      Spec.equal(saved["kind"], "vendor.custom"), "unknown tool kind was not preserved")
    XCTAssertTrue(Spec.equal(saved["name"], "vendor_tool"))
  }

  /// `Connection` is an *open* union: an unknown discriminator survives a round
  /// trip through the wildcard `unknown` case instead of throwing. This is the
  /// cross-runtime contract (Rust preserves the same input as
  /// `ConnectionKind::Unknown` rather than rejecting it).
  func testUnknownConnectionKindRoundTrips() throws {
    let source: [String: Any] = ["kind": "vendor.auth", "endpoint": "https://example.test"]
    let saved = try Connection.load(source).save()
    XCTAssertTrue(
      Spec.equal(saved["kind"], "vendor.auth"), "unknown connection kind was not preserved")
    XCTAssertTrue(Spec.equal(saved["endpoint"], "https://example.test"))
  }

  /// The base `Connection` fields survive a load/save round trip on every
  /// subtype.
  ///
  /// `model Connection` declares `authenticationMode` and `usageDescription`
  /// (`schema/model/connection/connection.tsp`), and every subtype `extends`
  /// it. The emitter now declares, loads, and saves these inherited fields on
  /// each subtype, so both must round-trip. Covering all six subtypes keeps the
  /// guarantee measured rather than assumed.
  func testConnectionBaseFieldsRoundTripOnEverySubtype() throws {
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

      let saved = try loaded.save()
      XCTAssertEqual(saved["kind"] as? String, kind, "\(kind): discriminator lost")
      for (key, value) in declared {
        XCTAssertEqual(saved[key] as? String, value, "\(kind): declared field \(key) lost")
      }

      XCTAssertEqual(
        saved["authenticationMode"] as? String, "system",
        "\(kind): authenticationMode lost on round trip")
      XCTAssertEqual(
        saved["usageDescription"] as? String, "respond to email on your behalf",
        "\(kind): usageDescription lost on round trip")
    }
  }

  // MARK: - Helpers

  /// Read binding names off the loaded tool, which the generated `Tool` enum
  /// exposes only through its raw payload.
  /// Named collections serialize either as a name-keyed map — the default — or
  /// as an already-named list when `collectionFormat` is `array`. Accept both,
  /// so this pins binding *identity* rather than the emitter's chosen shape.
  private static func bindingNames(_ tool: Tool) -> [String]? {
    switch tool.raw["bindings"] {
    case let list as [Any]:
      return list.compactMap { ($0 as? [String: Any])?["name"] as? String }.sorted()
    case let map as [String: Any]:
      return map.keys.sorted()
    default:
      return nil
    }
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

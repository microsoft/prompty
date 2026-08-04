import Foundation

import PromptyModel

import XCTest

/// Drives the canonical cross-runtime named-collection vector.
///
/// `spec/vectors/model/named_collection_vectors.json` (PR #447) pins how
/// `inputs`, `outputs`, and nested `properties` behave when they are written as
/// a *name-keyed map* rather than a list:
///
/// - the key supplies `name`,
/// - a bare scalar value infers `kind` and is stored in **`default`**, with
///   `example` left absent,
/// - an immediate **array** value is never a property and is rejected with the
///   full dotted path to the offending entry,
/// - arrays nested inside declared property fields (`default`, `items`) stay
///   valid — only the immediate named-entry position is closed.
///
/// This is deliberately **not** the direct `@coerce` contract that
/// `PropertyScalarCoercionVectorTests` asserts. There a bare scalar loaded
/// straight through the generated `Property` model lands in `example`. The two
/// contracts share a surface — "a scalar became a property" — and differ in the
/// field they populate, so a runtime that conflates them passes a naive check
/// while breaking one of the two. This suite pins `default` *and* the absence
/// of `example`; the sibling suite pins `example` *and* the absence of
/// `default`.
///
/// ## Why this asserts rather than skips
///
/// The scalar-coercion sibling is blocked at the pinned emitter because the
/// generated `Property.load` cannot accept a bare scalar at all. The
/// named-collection form is different: the generated model never sees the map,
/// because `Loader` normalizes it into the canonical list first. Every defect
/// the fixture describes was therefore in this repository's hand-written
/// loader, not in generated code, and is fixed directly.
///
/// One save-side clause remains outside the loader's reach:
/// `collectionFormat: "object"` asks `save()` to re-emit a name-keyed map when
/// every entry has a unique non-empty name. That is generated code, so those
/// vectors record a *documented blocked baseline* tied to the emitter pin —
/// their entry semantics are still asserted in full.
///
/// ## Robustness to a moving fixture
///
/// This file has already been rewritten several times upstream, so the suite
/// does not pin its vector count or ordering. It instead requires the vectors
/// the request names, and processes every vector present — an unrecognised
/// `operation` fails rather than being skipped, so a future clause cannot slip
/// through unasserted.
@testable import Prompty

final class NamedCollectionVectorTests: XCTestCase {

  private static let vectorPath = "model/named_collection_vectors.json"

  /// The emitter pin whose known save-side gap the blocked baseline describes.
  private static let blockedAtEmitterVersion = "0.4.2"

  /// Vectors this request names explicitly. The fixture may grow; it may not
  /// quietly lose one of these.
  private static let requiredVectorNames: Set<String> = [
    "string_scalar_in_name_keyed_inputs_infers_property",
    "integer_scalar_in_name_keyed_inputs_infers_property",
    "float_scalar_in_name_keyed_inputs_infers_property",
    "boolean_scalar_in_name_keyed_inputs_infers_property",
    "scalar_array_shorthand_in_name_keyed_inputs_is_rejected",
    "array_value_in_name_keyed_inputs_is_rejected",
    "array_value_in_nested_properties_is_rejected",
  ]

  // MARK: - The vector

  func testCanonicalNamedCollectionVector() throws {
    // Only genuine absence may skip. Routing every error through a `try?` would
    // turn malformed JSON or a reshaped root into a green run.
    let vectorURL =
      Spec.root
      .appendingPathComponent("vectors")
      .appendingPathComponent("model")
      .appendingPathComponent("named_collection_vectors.json")

    guard FileManager.default.fileExists(atPath: vectorURL.path) else {
      throw XCTSkip(
        "spec/vectors/\(Self.vectorPath) is not on this branch yet (PR #447 is "
          + "unmerged), so the canonical named-collection fixture cannot be "
          + "asserted. This suite activates automatically when the file lands; "
          + "NamedCollectionShorthandTests covers the same rules meanwhile.")
    }

    let document = try Spec.vectorObject(Self.vectorPath)
    let vectors = try Self.validateVectorShape(document)

    var failures: [String] = []
    var blocked: [String] = []
    var asserted: [String] = []

    for vector in vectors {
      guard let name = vector["name"] as? String else {
        failures.append("a vector declares no `name`")
        continue
      }
      guard let operation = vector["operation"] as? String else {
        failures.append("\(name): declares no `operation`")
        continue
      }
      guard let input = vector["input"] as? [String: Any] else {
        failures.append("\(name): declares no `input` object")
        continue
      }
      guard let expected = vector["expected"] as? [String: Any] else {
        failures.append("\(name): declares no `expected` object")
        continue
      }

      switch operation {
      case "load-error":
        Self.runLoadError(
          name: name, input: input, expected: expected,
          failures: &failures, asserted: &asserted)
      case "load-save-reload":
        // `collectionPath` is a sibling of `expected`, not a member of it.
        guard let collectionPath = vector["collectionPath"] as? String else {
          failures.append(
            "\(name): a load-save-reload vector declares no `collectionPath`, so "
              + "there is no way to know which collection it pins")
          continue
        }
        Self.runLoadSaveReload(
          name: name, input: input, expected: expected, collectionPath: collectionPath,
          failures: &failures, blocked: &blocked, asserted: &asserted)
      default:
        // A new operation must not ride along unasserted.
        failures.append(
          "\(name): unrecognised operation `\(operation)`. The fixture grew a "
            + "clause this suite does not evaluate, which would otherwise pass "
            + "silently.")
      }
    }

    if !blocked.isEmpty {
      // Tie the documented baseline to the pin it describes, so bumping the
      // emitter without closing the gap fails instead of resting on stale prose.
      let pin = Self.pinnedEmitterVersion()
      if pin != Self.blockedAtEmitterVersion {
        failures.append(
          "the object-form save baseline is documented for "
            + "@typra/emitter@\(Self.blockedAtEmitterVersion), but schema/package.json "
            + "now pins \(pin ?? "<unreadable>"). Re-evaluate whether generated "
            + "save() can emit the name-keyed object form: \(blocked.joined(separator: "; "))")
      }
    }

    XCTAssertTrue(
      failures.isEmpty,
      "named-collection vector failures:\n  - " + failures.joined(separator: "\n  - "))

    // Non-vacuity: the fixture must actually have exercised the runtime.
    XCTAssertFalse(
      asserted.isEmpty,
      "no named-collection vector was asserted — the fixture parsed but drove "
        + "nothing, so this suite would report success while measuring nothing")
  }

  // MARK: - load-error

  private static func runLoadError(
    name: String, input: [String: Any], expected: [String: Any],
    failures: inout [String], asserted: inout [String]
  ) {
    let contents: String
    do {
      contents = try frontmatter(input)
    } catch {
      failures.append("\(name): could not render input as frontmatter: \(error)")
      return
    }

    do {
      _ = try Loader.load(contents: contents, basePath: FileManager.default.currentDirectoryPath)
      failures.append(
        "\(name): expected the load to be rejected, but it succeeded. The "
          + "invalid entry was accepted silently.")
      return
    } catch let error as LoadError {
      let token = expected["error"] as? String
      guard token == "invalid-named-collection-entry" else {
        // A future error class this suite does not model structurally: the
        // rejection itself is still asserted, and recorded as such.
        asserted.append("\(name) (throw only)")
        return
      }
      guard case .invalidNamedCollectionEntry(let path, let category) = error else {
        failures.append(
          "\(name): expected LoadError.invalidNamedCollectionEntry, got \(error). "
            + "A generic rejection does not carry the path and value category the "
            + "contract requires.")
        return
      }
      if let expectedPath = expected["path"] as? String, path != expectedPath {
        failures.append("\(name): path expected `\(expectedPath)`, got `\(path)`")
      }
      if let expectedCategory = expected["valueCategory"] as? String, category != expectedCategory {
        failures.append(
          "\(name): valueCategory expected `\(expectedCategory)`, got `\(category)`")
      }
      // The machine-readable token must reach a consumer reading the message.
      if !String(describing: error).contains("invalid-named-collection-entry") {
        failures.append(
          "\(name): the rendered diagnostic does not contain the "
            + "`invalid-named-collection-entry` token: \(error)")
      }
      asserted.append(name)
    } catch {
      failures.append("\(name): rejected with a non-LoadError: \(error)")
    }
  }

  // MARK: - load-save-reload

  private static func runLoadSaveReload(
    name: String, input: [String: Any], expected: [String: Any], collectionPath: String,
    failures: inout [String], blocked: inout [String], asserted: inout [String]
  ) {
    let saved: [String: Any]
    do {
      let contents = try frontmatter(input)
      let agent = try Loader.load(
        contents: contents, basePath: FileManager.default.currentDirectoryPath)
      saved = try agent.save()
    } catch {
      failures.append("\(name): load/save threw: \(error)")
      return
    }

    let rawCollection = saved[collectionPath]
    let wireEntries: [[String: Any]]
    let actualFormat: String
    if let list = rawCollection as? [[String: Any]] {
      wireEntries = list
      actualFormat = "array"
    } else if let map = rawCollection as? [String: Any] {
      wireEntries = map.keys.sorted().compactMap { key in
        var entry = (map[key] as? [String: Any]) ?? [:]
        entry["name"] = key
        return entry
      }
      actualFormat = "object"
    } else {
      failures.append(
        "\(name): saved `\(collectionPath)` is neither an array nor an object: "
          + "\(String(describing: rawCollection))")
      return
    }

    // --- collectionFormat -------------------------------------------------
    if let expectedFormat = expected["collectionFormat"] as? String,
      expectedFormat != actualFormat
    {
      if expectedFormat == "object" && actualFormat == "array" {
        // Generated `save()` always emits the ordered array. Lossless, but not
        // yet the canonical wire form. Entry semantics below are still asserted.
        blocked.append("\(name) (save emits array, contract wants object)")
      } else {
        failures.append(
          "\(name): collectionFormat expected `\(expectedFormat)`, got `\(actualFormat)`")
      }
    }

    // --- wireEntries.absentFields (pre-reload wire shape) ------------------
    if let wireExpectations = expected["wireEntries"] as? [[String: Any]] {
      for wireExpectation in wireExpectations {
        guard let index = wireExpectation["index"] as? Int else { continue }
        guard index < wireEntries.count else {
          failures.append("\(name): wireEntries[\(index)] is out of range")
          continue
        }
        // Read the raw list here: the object branch above synthesises `name`
        // from the key, which would mask an absent-name expectation.
        let rawEntry = (rawCollection as? [[String: Any]])?[index] ?? wireEntries[index]
        for absent in (wireExpectation["absentFields"] as? [String]) ?? []
        where
          rawEntry[absent] != nil
        {
          failures.append(
            "\(name): wire entry \(index) should omit `\(absent)`, but it is present "
              + "as \(String(describing: rawEntry[absent]))")
        }
      }
    }

    // --- entries ----------------------------------------------------------
    guard let expectedEntries = expected["entries"] as? [[String: Any]] else {
      asserted.append("\(name) (format only)")
      return
    }

    guard expectedEntries.count == wireEntries.count else {
      failures.append(
        "\(name): expected \(expectedEntries.count) entries, got \(wireEntries.count)")
      return
    }

    let absentEntryFields = (expected["absentEntryFields"] as? [String]) ?? []

    for (index, expectedEntry) in expectedEntries.enumerated() {
      let actualEntry = wireEntries[index]
      compare(
        expected: canonicalizeExpected(expectedEntry), actual: actualEntry,
        path: "\(name).\(collectionPath)[\(index)]", failures: &failures)

      for absent in absentEntryFields where actualEntry[absent] != nil {
        failures.append(
          "\(name).\(collectionPath)[\(index)]: `\(absent)` must be absent, but it is "
            + "\(String(describing: actualEntry[absent])). The named-collection scalar "
            + "shorthand stores the value in `default`; populating `\(absent)` too "
            + "would blur it with the direct @coerce contract.")
      }
    }

    // --- reload: the saved wire must load again and re-save identically ----
    do {
      let reloaded = try Prompty.load(saved)
      let resaved = try reloaded.save()
      let before = try jsonText(saved)
      let after = try jsonText(resaved)
      if before != after {
        failures.append(
          "\(name): save/reload is not stable.\n      first:  \(before)\n      second: \(after)")
      }
    } catch {
      failures.append("\(name): the saved wire form did not reload: \(error)")
    }

    asserted.append(name)
  }

  // MARK: - Shape validation

  private static func validateVectorShape(_ document: [String: Any]) throws -> [[String: Any]] {
    guard let vectors = document["vectors"] as? [[String: Any]] else {
      throw VectorFailure(
        "the fixture declares no `vectors` array; its shape changed and this "
          + "suite would otherwise assert nothing")
    }
    guard !vectors.isEmpty else {
      throw VectorFailure("the fixture declares zero vectors")
    }

    let present = Set(vectors.compactMap { $0["name"] as? String })
    let missing = requiredVectorNames.subtracting(present).sorted()
    guard missing.isEmpty else {
      throw VectorFailure(
        "the fixture no longer declares: \(missing.joined(separator: ", ")). "
          + "These are the cases this gate exists to assert, so their absence is "
          + "a fixture regression rather than a reason to pass.")
    }
    return vectors
  }

  // MARK: - Helpers

  /// Render a vector input as `.prompty` frontmatter.
  ///
  /// JSON is a subset of YAML, so the vector's own JSON is used verbatim rather
  /// than re-serialised through a YAML writer that could reinterpret scalars.
  private static func frontmatter(_ input: [String: Any]) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: input, options: [])
    return "---\n" + String(decoding: data, as: UTF8.self) + "\n---\nsystem:\nvector\n"
  }

  /// Adapt an expected entry's *shape* to the saved wire form.
  ///
  /// Only a name-keyed `properties` map is rewritten into the ordered named
  /// list the wire uses. No value is altered and nothing is dropped, so every
  /// semantic assertion still originates in the fixture. This is done locally
  /// rather than by calling `Loader` so the comparison cannot become
  /// self-referential.
  private static func canonicalizeExpected(_ entry: [String: Any]) -> [String: Any] {
    var result = entry
    if let nested = entry["properties"] as? [String: Any] {
      result["properties"] = nested.keys.sorted().map { key -> [String: Any] in
        var child = (nested[key] as? [String: Any]) ?? [:]
        child["name"] = key
        return canonicalizeExpected(child)
      }
    } else if let nested = entry["properties"] as? [[String: Any]] {
      result["properties"] = nested.map(canonicalizeExpected)
    }
    if let items = entry["items"] as? [String: Any] {
      result["items"] = canonicalizeExpected(items)
    }
    return result
  }

  /// Subset comparison: every field the fixture states must match exactly.
  ///
  /// Fields the runtime adds beyond the fixture are tolerated — the file is
  /// still being revised upstream, and pinning its complement here would make
  /// the gate brittle without making it stronger.
  private static func compare(
    expected: [String: Any], actual: [String: Any], path: String, failures: inout [String]
  ) {
    for key in expected.keys.sorted() {
      let expectedValue = expected[key] as Any
      let actualValue = actual[key]

      // An omitted wire `name` is the empty name in model terms.
      if key == "name", actualValue == nil, (expectedValue as? String)?.isEmpty == true {
        continue
      }

      guard let actualValue else {
        failures.append(
          "\(path).\(key): missing, expected \((try? jsonText(expectedValue)) ?? "?")")
        continue
      }

      if let expectedDict = expectedValue as? [String: Any],
        let actualDict = actualValue as? [String: Any]
      {
        compare(
          expected: expectedDict, actual: actualDict, path: "\(path).\(key)", failures: &failures)
        continue
      }

      if let expectedList = expectedValue as? [[String: Any]],
        let actualList = actualValue as? [[String: Any]]
      {
        guard expectedList.count == actualList.count else {
          failures.append(
            "\(path).\(key): expected \(expectedList.count) elements, got \(actualList.count)")
          continue
        }
        for (index, element) in expectedList.enumerated() {
          compare(
            expected: element, actual: actualList[index], path: "\(path).\(key)[\(index)]",
            failures: &failures)
        }
        continue
      }

      // Scalars and heterogeneous lists compare as JSON text. `Spec.equal`
      // is not used here: its Bool branch treats `0` and `false` as equal,
      // which would let an integer default satisfy a boolean expectation.
      let expectedText = (try? jsonText(expectedValue)) ?? "<unencodable>"
      let actualText = (try? jsonText(actualValue)) ?? "<unencodable>"
      if expectedText != actualText {
        failures.append("\(path).\(key): expected \(expectedText), got \(actualText)")
      }
    }
  }

  /// The `@typra/emitter` version `schema/package.json` pins.
  private static func pinnedEmitterVersion() -> String? {
    let url =
      Spec.root
      .deletingLastPathComponent()
      .appendingPathComponent("schema")
      .appendingPathComponent("package.json")
    guard let data = try? Data(contentsOf: url),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let dependencies = object["dependencies"] as? [String: Any],
      let version = dependencies["@typra/emitter"] as? String
    else {
      return nil
    }
    return version
  }

  /// Render a value as JSON text, type faithfully.
  private static func jsonText(_ value: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: ["v": value], options: [.sortedKeys])
    return String(decoding: data, as: UTF8.self)
  }
}

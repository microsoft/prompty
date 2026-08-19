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
      let entryPath = "\(name).\(collectionPath)[\(index)]"
      compare(
        expected: canonicalizeExpected(expectedEntry), actual: actualEntry,
        path: entryPath, failures: &failures)

      // `canonicalizeExpected` flattens a name-keyed nested `properties` map
      // into the ordered list so the *semantic* comparison can proceed. That
      // adaptation also erases the shape difference, so a nested collection
      // saved as the array fallback would compare equal to a fixture stating
      // the canonical object form. Walk the two in parallel to recover it.
      blocked += nestedObjectFormGaps(
        expected: expectedEntry, actual: actualEntry, path: entryPath)

      for absent in absentEntryFields where actualEntry[absent] != nil {
        failures.append(
          "\(entryPath): `\(absent)` must be absent, but it is "
            + "\(String(describing: actualEntry[absent])). The named-collection scalar "
            + "shorthand stores the value in `default`; populating `\(absent)` too "
            + "would blur it with the direct @coerce contract.")
      }
    }

    // --- reload: the saved wire must load again and re-save identically ----
    do {
      let reloaded = try Agent.load(saved)
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

  // MARK: - Nested object-form detection
  //
  // These run whether or not the canonical fixture is on the branch, so the
  // detection above is exercised while `testCanonicalNamedCollectionVector` is
  // still skipping on absence.

  /// The canonicalised comparison pipeline cannot see a nested object-form gap.
  ///
  /// This is the justification for `nestedObjectFormGaps` existing, pinned as a
  /// test so it cannot quietly stop being true. The fixture states `properties`
  /// as a name-keyed map — the canonical object form — while the runtime saved
  /// the ordered array fallback.
  ///
  /// The blindness is created by `canonicalizeExpected`, not by `compare`:
  /// `compare` on its own would see a map on one side and a list on the other.
  /// Canonicalisation reshapes the expectation to the wire form first — which
  /// is what lets the semantic assertions run at all — and that same adaptation
  /// erases the shape difference. Both steps are exercised here together
  /// because it is their composition that loses the signal.
  func testCanonicalisedComparisonPipelineCannotSeeNestedObjectFormGap() {
    let expected: [String: Any] = [
      "name": "location",
      "kind": "object",
      "properties": ["city": ["kind": "string"]],
    ]
    let actual: [String: Any] = [
      "name": "location",
      "kind": "object",
      "properties": [["name": "city", "kind": "string"]],
    ]

    var failures: [String] = []
    Self.compare(
      expected: Self.canonicalizeExpected(expected), actual: actual, path: "probe",
      failures: &failures)

    XCTAssertTrue(
      failures.isEmpty,
      "the canonicalised pipeline was expected to be blind to this gap; if it "
        + "now reports it, nestedObjectFormGaps may be redundant: \(failures)")
  }

  /// The same pair, seen by the parallel walk.
  func testNestedObjectFormGapIsDetected() {
    let expected: [String: Any] = [
      "name": "location",
      "kind": "object",
      "properties": ["city": ["kind": "string"]],
    ]
    let actual: [String: Any] = [
      "name": "location",
      "kind": "object",
      "properties": [["name": "city", "kind": "string"]],
    ]

    let gaps = Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe")

    XCTAssertEqual(gaps.count, 1, "expected exactly one gap, got \(gaps)")
    XCTAssertEqual(
      gaps.first, "probe.properties (save emits array, contract wants object)")
  }

  /// A fixture that states the array form is not a gap.
  func testArrayFormExpectationIsNotReportedAsAGap() {
    let expected: [String: Any] = [
      "name": "location",
      "properties": [["name": "city", "kind": "string"]],
    ]
    let actual: [String: Any] = [
      "name": "location",
      "properties": [["name": "city", "kind": "string"]],
    ]

    XCTAssertTrue(
      Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe").isEmpty)
  }

  /// A runtime that already emits the object form is not a gap either.
  ///
  /// Without this, the detection could be satisfied by always reporting, and
  /// the baseline would never clear when the emitter is fixed.
  func testObjectFormActualIsNotReportedAsAGap() {
    let expected: [String: Any] = [
      "name": "location",
      "properties": ["city": ["kind": "string"]],
    ]
    let actual: [String: Any] = [
      "name": "location",
      "properties": ["city": ["kind": "string"]],
    ]

    XCTAssertTrue(
      Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe").isEmpty)
  }

  /// Gaps are found at every depth, not just the first.
  ///
  /// The coordinator's reported row is one level down (`inputs[0].properties`).
  /// A detector that only checked the top nesting level would satisfy that row
  /// while missing anything deeper.
  func testNestedObjectFormGapsAreFoundAtEveryDepth() {
    let expected: [String: Any] = [
      "name": "outer",
      "properties": [
        "middle": [
          "kind": "object",
          "properties": [
            "inner": ["kind": "object", "properties": ["leaf": ["kind": "string"]]]
          ],
        ]
      ],
    ]
    let actual: [String: Any] = [
      "name": "outer",
      "properties": [
        [
          "name": "middle", "kind": "object",
          "properties": [
            [
              "name": "inner", "kind": "object",
              "properties": [["name": "leaf", "kind": "string"]],
            ]
          ],
        ]
      ],
    ]

    let gaps = Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe")

    XCTAssertEqual(
      gaps,
      [
        "probe.properties (save emits array, contract wants object)",
        "probe.properties.middle.properties (save emits array, contract wants object)",
        "probe.properties.middle.properties.inner.properties "
          + "(save emits array, contract wants object)",
      ],
      "every nesting level must be reported, with a path that locates it")
  }

  /// A gap inside `items` is reported too.
  func testObjectFormGapInsideItemsIsDetected() {
    let expected: [String: Any] = [
      "name": "rows",
      "kind": "array",
      "items": ["kind": "object", "properties": ["cell": ["kind": "string"]]],
    ]
    let actual: [String: Any] = [
      "name": "rows",
      "kind": "array",
      "items": ["kind": "object", "properties": [["name": "cell", "kind": "string"]]],
    ]

    XCTAssertEqual(
      Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe"),
      ["probe.items.properties (save emits array, contract wants object)"])
  }

  /// Descent pairs children by name, not by position.
  ///
  /// A map has no order, so pairing the sorted expectation against the saved
  /// list positionally would compare unrelated children whenever the runtime's
  /// declaration order differs from alphabetical.
  func testDescentPairsChildrenByNameNotPosition() {
    let expected: [String: Any] = [
      "name": "outer",
      "properties": [
        "alpha": ["kind": "string"],
        "beta": ["kind": "object", "properties": ["leaf": ["kind": "string"]]],
      ],
    ]
    // Saved in declaration order, which is the reverse of alphabetical.
    let actual: [String: Any] = [
      "name": "outer",
      "properties": [
        [
          "name": "beta", "kind": "object",
          "properties": [["name": "leaf", "kind": "string"]],
        ],
        ["name": "alpha", "kind": "string"],
      ],
    ]

    let gaps = Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe")

    XCTAssertEqual(
      gaps,
      [
        "probe.properties (save emits array, contract wants object)",
        "probe.properties.beta.properties (save emits array, contract wants object)",
      ],
      "the nested gap under `beta` must be found even though `beta` is not the "
        + "child that sorts first")
  }

  /// A nested gap is still found when the saved child omits its `name`.
  ///
  /// An unnamed composite is exactly the case the canonical fixture names, so
  /// pairing purely by name would drop the child that matters most and report
  /// nothing for anything beneath it.
  func testNestedObjectFormGapIsFoundWhenTheSavedChildOmitsItsName() {
    let expected: [String: Any] = [
      "name": "outer",
      "properties": [
        "inner": ["kind": "object", "properties": ["leaf": ["kind": "string"]]]
      ],
    ]
    let actual: [String: Any] = [
      "name": "outer",
      // The saved child carries no `name`, so it cannot be looked up by key.
      "properties": [
        ["kind": "object", "properties": [["name": "leaf", "kind": "string"]]]
      ],
    ]

    let gaps = Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe")

    XCTAssertEqual(
      gaps,
      [
        "probe.properties (save emits array, contract wants object)",
        "probe.properties.inner.properties (save emits array, contract wants object)",
      ],
      "the gap beneath an unnamed saved child must still be reported")
  }

  /// A positional fallback never binds a child that names a different key.
  ///
  /// Object form is keyed, so position is only a sound last resort for an
  /// entry that omits `name`. Binding a differently-named entry would descend
  /// into an unrelated child and report its gaps against the wrong key.
  func testPositionalFallbackRefusesDifferentlyNamedChild() {
    let expected: [String: Any] = [
      "name": "outer",
      "properties": [
        "alpha": ["kind": "object", "properties": ["leaf": ["kind": "string"]]]
      ],
    ]
    // The sole saved child names a different key and carries a nested gap of
    // its own. Pairing it to `alpha` would misattribute that gap.
    let actual: [String: Any] = [
      "name": "outer",
      "properties": [
        ["name": "beta", "kind": "object", "properties": [["name": "leaf", "kind": "string"]]]
      ],
    ]

    XCTAssertEqual(
      Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe"),
      ["probe.properties (save emits array, contract wants object)"],
      "a differently-named child must not be bound by position")
  }

  /// Elimination pairing finds a nameless child at a non-corresponding index.
  ///
  /// `alpha` resolves by name to index 1, leaving `beta` unmatched. Index-based
  /// pairing would inspect index 1, find `alpha` there, and never reach the
  /// nameless child at index 0 — silently losing beta's gap. Elimination pairs
  /// the single unmatched key to the single nameless child regardless of where
  /// it sits.
  func testEliminationPairingIgnoresPosition() {
    let expected: [String: Any] = [
      "name": "outer",
      "properties": [
        "alpha": ["kind": "string"],
        "beta": ["kind": "object", "properties": ["leaf": ["kind": "string"]]],
      ],
    ]
    // beta's child is saved first and unnamed; alpha's is saved second.
    let actual: [String: Any] = [
      "name": "outer",
      "properties": [
        ["kind": "object", "properties": [["name": "leaf", "kind": "string"]]],
        ["name": "alpha", "kind": "string"],
      ],
    ]

    XCTAssertEqual(
      Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe"),
      [
        "probe.properties (save emits array, contract wants object)",
        "probe.properties.beta.properties (save emits array, contract wants object)",
      ],
      "a nameless child must be found by elimination, not by index")
  }

  /// Two nameless children are ambiguous, so neither is guessed.
  ///
  /// Attributing a gap to a key that cannot be established is the same
  /// misattribution keyed pairing exists to prevent. The top-level array-form
  /// gap is still reported, so the real problem stays visible.
  func testAmbiguousNamelessChildrenAreNotGuessed() {
    let nested: [String: Any] = ["kind": "object", "properties": ["leaf": ["kind": "string"]]]
    let expected: [String: Any] = [
      "name": "outer",
      "properties": ["alpha": nested, "beta": nested],
    ]
    let savedChild: [String: Any] = [
      "kind": "object", "properties": [["name": "leaf", "kind": "string"]],
    ]
    let actual: [String: Any] = [
      "name": "outer",
      "properties": [savedChild, savedChild],
    ]

    XCTAssertEqual(
      Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe"),
      ["probe.properties (save emits array, contract wants object)"],
      "ambiguous nameless children must not be paired to arbitrary keys")
  }

  /// Duplicate names disqualify name-addressing entirely.
  ///
  /// Both saved children claim `alpha`, so building the index first would let
  /// the second silently overwrite the first and the descent would then report
  /// a gap found in whichever entry happened to survive. With duplicates
  /// present there is no way to tell which `alpha` the contract meant, so
  /// descending into the survivor is a guess dressed up as a match. The
  /// pre-scan refuses the index and only the honest top-level gap is reported.
  func testDuplicateNamesDisqualifyNameAddressing() {
    let expected: [String: Any] = [
      "name": "outer",
      "properties": ["alpha": ["kind": "object", "properties": ["leaf": ["kind": "string"]]]],
    ]
    // Two entries named `alpha`; only the second carries a nested collection,
    // so a last-wins collapse would surface a gap the contract cannot attribute.
    let actual: [String: Any] = [
      "name": "outer",
      "properties": [
        ["name": "alpha", "kind": "string"],
        ["name": "alpha", "kind": "object", "properties": [["name": "leaf", "kind": "string"]]],
      ],
    ]

    XCTAssertEqual(
      Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe"),
      ["probe.properties (save emits array, contract wants object)"],
      "duplicate names must disqualify the name index instead of collapsing last-wins")
  }

  /// Duplicates must not decay into an elimination match.
  ///
  /// Refusing the index by returning an *empty* one would leave `alpha`
  /// unmatched, and the lone nameless child would then look like its unique
  /// elimination partner — so hiding `alpha` behind a duplicate would conjure a
  /// match that direct addressing correctly denied. The nameless child here
  /// belongs to neither `alpha`, so no nested gap may be reported.
  func testDuplicateNamesAlsoSuppressEliminationPairing() {
    let expected: [String: Any] = [
      "name": "outer",
      "properties": ["alpha": ["kind": "object", "properties": ["leaf": ["kind": "string"]]]],
    ]
    let actual: [String: Any] = [
      "name": "outer",
      "properties": [
        ["name": "alpha", "kind": "string"],
        ["name": "alpha", "kind": "string"],
        ["kind": "object", "properties": [["name": "leaf", "kind": "string"]]],
      ],
    ]

    XCTAssertEqual(
      Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe"),
      ["probe.properties (save emits array, contract wants object)"],
      "an unaddressable collection must suppress elimination, not just name lookup")
  }

  /// A malformed `name` refuses the index rather than passing as nameless.
  ///
  /// A non-string `name` is dropped by the uniqueness scan yet is not nameless
  /// either, so without an explicit refusal it vanishes from both pairing paths
  /// and the *other* child is eliminated into `alpha` unopposed.
  func testMalformedNameRefusesNameAddressing() {
    let expected: [String: Any] = [
      "name": "outer",
      "properties": ["alpha": ["kind": "object", "properties": ["leaf": ["kind": "string"]]]],
    ]
    let actual: [String: Any] = [
      "name": "outer",
      "properties": [
        ["name": 123, "kind": "string"],
        ["kind": "object", "properties": [["name": "leaf", "kind": "string"]]],
      ],
    ]

    XCTAssertEqual(
      Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe"),
      ["probe.properties (save emits array, contract wants object)"],
      "a malformed name must refuse the index instead of counting as nameless")
  }

  /// Duplicate *expected* names cannot be matched against a keyed actual.
  ///
  /// The object form holds one `alpha`, so attributing it to both expected
  /// occurrences would report the same nested gap twice against entries that
  /// were never separately observed. Uniqueness is required on both sides.
  func testDuplicateExpectedNamesRefuseObjectFormPairing() {
    let expected: [String: Any] = [
      "name": "outer",
      "properties": [
        ["name": "alpha", "kind": "object", "properties": ["left": ["kind": "string"]]],
        ["name": "alpha", "kind": "object", "properties": ["right": ["kind": "string"]]],
      ],
    ]
    let actual: [String: Any] = [
      "name": "outer",
      "properties": [
        "alpha": ["kind": "object", "properties": [["name": "leaf", "kind": "string"]]]
      ],
    ]

    XCTAssertEqual(
      Self.nestedObjectFormGaps(expected: expected, actual: actual, path: "probe"),
      [],
      "a single actual child must not be attributed to several expected entries")
  }

  /// Nested named collections are saved in alphabetical order.
  ///
  /// Object-form named collections are keyed rather than order-bearing, so
  /// this is not a contract assertion about that form. It pins the *array*
  /// save form the runtime currently emits, which does carry order:
  /// `canonicalizeExpected` sorts a name-keyed expectation into a list before
  /// `compare` pairs it positionally, and that pairing stays sound only while
  /// the runtime orders nested collections by name. If the emitter ever
  /// switches to declaration order, this fails directly instead of surfacing
  /// as a confusing field mismatch somewhere downstream.
  func testNestedNamedCollectionsSaveInAlphabeticalOrder() throws {
    let input: [String: Any] = [
      "name": "v", "model": ["id": "gpt-4"],
      "inputs": [
        "outer": [
          "kind": "object",
          // Deliberately not alphabetical in the source.
          "properties": [
            "zebra": ["kind": "string"],
            "apple": ["kind": "string"],
            "middle": ["kind": "string"],
          ],
        ]
      ],
    ]

    let agent = try Loader.load(
      contents: Self.frontmatter(input), basePath: FileManager.default.currentDirectoryPath)
    // Request the array wire form so nested ordering is observable; the default
    // object form is a name-keyed map whose key order is not meaningful.
    let saved = try agent.save(SaveContext(collectionFormat: "array"))

    let entries = (saved["inputs"] as? [[String: Any]]) ?? []
    let nested = (entries.first?["properties"] as? [[String: Any]]) ?? []
    XCTAssertEqual(
      nested.compactMap { $0["name"] as? String }, ["apple", "middle", "zebra"],
      "nested named collections are expected to save in alphabetical order")
  }

  /// The detection is actually wired into the vector path, not just callable.
  ///
  /// Every test above exercises `nestedObjectFormGaps` directly, so all of them
  /// would still pass if the call in `runLoadSaveReload` were deleted. This
  /// drives the real vector path with a synthetic vector. The generated model
  /// now saves nested `properties` in the canonical object form, so the real
  /// path reports no gap — the emitter defect this once pinned is fixed.
  func testNestedGapReachesBlockedThroughTheVectorPath() throws {
    let input: [String: Any] = [
      "name": "v", "model": ["id": "gpt-4"],
      "inputs": [
        "location": ["kind": "object", "properties": ["street": ["kind": "string"]]]
      ],
    ]

    let agent = try Loader.load(
      contents: Self.frontmatter(input), basePath: FileManager.default.currentDirectoryPath)
    let saved = try agent.save()

    // Both the top-level and the nested collection round-trip in the canonical
    // object (name-keyed map) form — the emitter no longer falls back to the
    // ordered-array form that this gate once pinned.
    let inputs = saved["inputs"] as? [String: Any]
    let location = inputs?["location"] as? [String: Any]
    let nested = location?["properties"] as? [String: Any]
    XCTAssertNotNil(nested?["street"], "nested properties round-trip as a name-keyed object")
    XCTAssertNil(
      location?["properties"] as? [[String: Any]],
      "the emitter no longer emits the array fallback for nested properties")

    // The saved wire form reloads and re-saves identically.
    let reloaded = try Agent.load(saved)
    let resaved = try reloaded.save()
    XCTAssertEqual(try Self.jsonText(saved), try Self.jsonText(resaved), "save/reload must be stable")
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

  /// Nested collections the fixture states in canonical object form that the
  /// runtime saved as the ordered array fallback.
  ///
  /// The top-level `collectionFormat` clause records this gap for the
  /// collection named by `collectionPath`. Nested collections have no such
  /// clause, and `canonicalizeExpected` adapts their shape before comparison,
  /// so without this walk a nested array fallback is indistinguishable from a
  /// nested canonical object. Returned paths join the `blocked` baseline, which
  /// is tied to the emitter pin — so bumping the pin without closing the gap
  /// fails rather than resting on stale prose.
  ///
  /// Only the fixture's own structure drives this: a nested map is read as a
  /// request for object form, a nested list as a request for the array form.
  /// Nothing is inferred about collections the fixture does not mention.
  private static func nestedObjectFormGaps(
    expected: [String: Any], actual: [String: Any], path: String
  ) -> [String] {
    var gaps: [String] = []

    if let expectedMap = expected["properties"] as? [String: Any] {
      if actual["properties"] is [Any] {
        gaps.append("\(path).properties (save emits array, contract wants object)")
      }
      // Descend by name: object-form named collections are keyed, not
      // order-bearing, so a key is the only sound way to address a child.
      // The one child a key cannot address is an entry that omits `name` in
      // the array fallback (the unnamed-composite case). That entry is paired
      // by ELIMINATION — a single unmatched key facing a single nameless
      // child — never by index, because object form carries no positional
      // identity. Anything more ambiguous is left unpaired rather than
      // guessed, since attributing a gap to an unproven key is exactly the
      // misattribution this pairing exists to avoid.
      let sortedKeys = expectedMap.keys.sorted()
      // A `nil` index means the collection is not soundly name-addressable —
      // duplicate or malformed names. That has to suppress elimination as well,
      // not just name lookup: an empty index would inflate `unmatchedKeys`
      // until a lone nameless child looked like the unique partner of a lone
      // unmatched key, binding a gap to a key that never owned it. Refusing
      // both is the only reading that keeps "no proven owner" from decaying
      // into "sole remaining candidate".
      if let actualChildren = namedChildren(actual["properties"]) {
        let actualList = (actual["properties"] as? [[String: Any]]) ?? []
        // Absence of the key, not a failed String cast: a malformed `name` is
        // handled by `namedChildren` refusing the whole index above.
        let namelessChildren = actualList.filter { $0["name"] == nil }
        let unmatchedKeys = sortedKeys.filter { actualChildren[$0] == nil }
        let eliminationChild =
          (unmatchedKeys.count == 1 && namelessChildren.count == 1) ? namelessChildren[0] : nil

        for key in sortedKeys {
          guard let expectedChild = expectedMap[key] as? [String: Any] else { continue }
          var actualChild = actualChildren[key]
          if actualChild == nil, unmatchedKeys.first == key {
            actualChild = eliminationChild
          }
          guard let actualChild else { continue }
          gaps += nestedObjectFormGaps(
            expected: expectedChild, actual: actualChild, path: "\(path).properties.\(key)")
        }
      }
    } else if let expectedList = expected["properties"] as? [[String: Any]] {
      if let actualList = actual["properties"] as? [[String: Any]] {
        // Both sides are ordered lists, so pair positionally exactly as
        // `compare` does. Indexing by name here would drop children that omit
        // `name` and collapse duplicates onto one another.
        for (index, expectedChild) in expectedList.enumerated() where index < actualList.count {
          gaps += nestedObjectFormGaps(
            expected: expectedChild, actual: actualList[index],
            path: "\(path).properties[\(index)]")
        }
      } else {
        // Both sides must be unambiguous. Uniqueness of the *actual* keys is
        // guaranteed by the object form, but the expected list can repeat a
        // name, and each occurrence would then be attributed to the same single
        // actual child — reporting a nested gap once per duplicate against
        // entries that were never separately observed.
        let expectedNames = expectedList.compactMap { $0["name"] as? String }
        if let actualChildren = namedChildren(actual["properties"]),
          Set(expectedNames).count == expectedNames.count
        {
          for (index, expectedChild) in expectedList.enumerated() {
            guard let name = expectedChild["name"] as? String,
              let actualChild = actualChildren[name]
            else { continue }
            gaps += nestedObjectFormGaps(
              expected: expectedChild, actual: actualChild, path: "\(path).properties[\(index)]")
          }
        }
      }
    }

    if let expectedItems = expected["items"] as? [String: Any],
      let actualItems = actual["items"] as? [String: Any]
    {
      gaps += nestedObjectFormGaps(
        expected: expectedItems, actual: actualItems, path: "\(path).items")
    }

    return gaps
  }

  /// Index a nested `properties` collection by name, or `nil` when the
  /// collection cannot be soundly addressed by name at all.
  ///
  /// The list form is keyed only after a **uniqueness pre-scan**, mirroring the
  /// shared save rule that duplicate names force the whole-array fallback
  /// *before* any map construction. Building the map first and letting a later
  /// entry overwrite an earlier one would silently drop a child.
  ///
  /// Refusal is `nil` rather than an empty index because the two mean opposite
  /// things to the caller: an empty index says "this collection has no named
  /// children", which leaves every expected key unmatched and therefore
  /// eligible for elimination pairing. An unaddressable collection must
  /// suppress that path too, or a lone nameless child would be bound to a key
  /// that duplicates merely hid.
  ///
  /// A malformed `name` — present but not a string — also refuses the index. It
  /// would otherwise fall out of the uniqueness scan while also not counting as
  /// nameless, disappearing from both pairing paths without trace.
  private static func namedChildren(_ value: Any?) -> [String: [String: Any]]? {
    if let map = value as? [String: Any] {
      var result: [String: [String: Any]] = [:]
      for (key, child) in map {
        result[key] = (child as? [String: Any]) ?? [:]
      }
      return result
    }
    if let list = value as? [[String: Any]] {
      let declared = list.filter { $0["name"] != nil }
      let names = declared.compactMap { $0["name"] as? String }
      guard names.count == declared.count else { return nil }
      guard Set(names).count == names.count else { return nil }
      var result: [String: [String: Any]] = [:]
      for child in list {
        if let name = child["name"] as? String {
          result[name] = child
        }
      }
      return result
    }
    return [:]
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

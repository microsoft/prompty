import Foundation

import PromptyModel

import XCTest

@testable import Prompty

/// Acceptance gate for the canonical *optional collection presence* rule.
///
/// Presence of an optional collection is semantic, not cosmetic:
///
/// - an **absent** collection must stay omitted on save;
/// - an **explicitly present empty** collection may save as empty;
/// - save must **never synthesize** an empty collection from absent input.
///
/// The distinction matters because absent and empty mean different things to a
/// consumer. `enumValues: []` says "this property enumerates nothing", which is
/// a constraint; an omitted `enumValues` says "this property is not an
/// enumeration at all", which is the absence of one. A save that materializes
/// the schema default over an absent value destroys that distinction
/// irrecoverably — every subsequent round trip carries the invented `[]`, so no
/// later reader can tell it was never written.
///
/// This is a *cross-runtime* rule rather than a Swift preference, so these
/// assertions are written against the required behaviour and not against the
/// current pin. Where the pinned emitter violates the rule the test records the
/// violation explicitly rather than tolerating it silently — see
/// `testAbsentEnumValuesIsNotSynthesizedOnSave`.
final class OptionalCollectionPresenceTests: XCTestCase {

  /// A composite property with no `enumValues` key at all.
  ///
  /// Composite subtypes are the interesting case: a scalar `Property` resolves
  /// to the `.unknown` passthrough, which echoes its dictionary back and so
  /// cannot synthesize anything. Only the generated composite structs have
  /// stored properties that a schema default can populate.
  private static func compositeSource(kind: String) -> [String: Any] {
    var source: [String: Any] = ["name": "field_\(kind)", "kind": kind]
    switch kind {
    case "array": source["items"] = ["name": "item", "kind": "string"]
    case "object": source["properties"] = [["name": "child", "kind": "string"]]
    case "union": source["oneOf"] = [["name": "branch", "kind": "string"]]
    default: break
    }
    return source
  }

  private static let compositeKinds = ["array", "object", "union"]

  /// The subtype payload key each composite kind must retain.
  private static let payloadKeys = ["array": "items", "object": "properties", "union": "oneOf"]

  /// Positive control proving the round trip actually exercised a composite.
  ///
  /// Every absence assertion in this file is satisfied by an empty dictionary,
  /// so without this a regression that made `save()` return `[:]` would leave
  /// the gates green while testing nothing. The enum-case check is the second
  /// half: a scalar `Property` resolves to `.unknown`, which echoes its source
  /// dictionary verbatim — so if `load` ever stopped recognising these
  /// discriminators it would still reproduce `kind` and the payload, and only
  /// the case tells the difference.
  private func assertCompositeRoundTripped(
    _ property: Property,
    _ saved: [String: Any],
    kind: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    switch (kind, property) {
    case ("array", .arrayProperty), ("object", .objectProperty), ("union", .unionProperty):
      break
    default:
      XCTFail(
        "'\(kind)' did not load as its composite case — got \(property), so the "
          + "absence assertions would be checking the .unknown passthrough instead",
        file: file, line: line)
    }
    XCTAssertEqual(
      saved["kind"] as? String, kind, "'\(kind)' lost its discriminator on save",
      file: file, line: line)
    XCTAssertEqual(
      saved["name"] as? String, "field_\(kind)", "'\(kind)' lost its name on save",
      file: file, line: line)
    XCTAssertNotNil(
      saved[Self.payloadKeys[kind] ?? ""],
      "'\(kind)' lost its subtype payload on save, so the payload is empty rather than clean",
      file: file, line: line)
  }

  // MARK: - Absent must stay omitted

  /// The strict half of the rule, and the half that loses information when it
  /// is broken.
  ///
  /// Passes at the current pin, so this is a preservation assertion rather than
  /// a characterization of a known defect: it goes red if save ever starts
  /// materializing the schema default over an absent value.
  func testAbsentEnumValuesIsNotSynthesizedOnSave() throws {
    for kind in Self.compositeKinds {
      let source = Self.compositeSource(kind: kind)
      XCTAssertNil(source["enumValues"], "fixture error: the source must omit enumValues")

      let property = try Property.load(source)
      let saved = try property.save()
      assertCompositeRoundTripped(property, saved, kind: kind)

      XCTAssertNil(
        saved["enumValues"],
        """
        \(kind) property synthesized 'enumValues' from absent input — \
        saved \(Spec.describe(saved["enumValues"])). Canonical rule: absent \
        optional collections must remain omitted; save must not synthesize an \
        empty collection from absent input.
        """
      )
    }
  }

  /// Absence must survive *repeated* saves, not just the first one.
  ///
  /// A save that is clean once but materializes the default on re-load would
  /// still destroy the distinction in any pipeline that round trips twice,
  /// which the loader does whenever a file is read, edited and written back.
  func testAbsenceIsStableAcrossRepeatedRoundTrips() throws {
    for kind in Self.compositeKinds {
      var current = try Property.load(Self.compositeSource(kind: kind)).save()
      for pass in 1...3 {
        let property = try Property.load(current)
        current = try property.save()
        assertCompositeRoundTripped(property, current, kind: kind)
        XCTAssertNil(
          current["enumValues"],
          "\(kind) property synthesized 'enumValues' on pass \(pass)"
        )
      }
    }
  }

  /// The same rule at the document level: a prompt that declares no tools must
  /// not acquire an empty `tools` collection by being saved.
  func testAbsentToolsStaysOmitted() throws {
    let saved = try Agent.load([
      "kind": "prompt",
      "name": "no-tools",
      "instructions": "hello",
    ]).save()

    XCTAssertNil(
      saved["tools"],
      "an absent 'tools' collection was synthesized as \(Spec.describe(saved["tools"]))"
    )
    // Positive control: an empty save output would satisfy the assertion above
    // while proving nothing.
    XCTAssertEqual(saved["name"] as? String, "no-tools", "the prompt lost its name on save")
    XCTAssertEqual(
      saved["instructions"] as? String, "hello", "the prompt lost its instructions on save")
  }

  /// The same rule for the other two document-level collections.
  ///
  /// `inputs` and `outputs` serialize through different paths than `tools` — the
  /// empty-name save-form gate had to be proven separately on each for exactly
  /// that reason — so absence has to be proven separately too. An
  /// implementation can synthesize one while correctly omitting another.
  func testAbsentInputsAndOutputsStayOmitted() throws {
    let saved = try Agent.load([
      "kind": "prompt",
      "name": "no-io",
      "instructions": "hello",
    ]).save()

    XCTAssertNil(
      saved["inputs"],
      "an absent 'inputs' collection was synthesized as \(Spec.describe(saved["inputs"]))"
    )
    XCTAssertNil(
      saved["outputs"],
      "an absent 'outputs' collection was synthesized as \(Spec.describe(saved["outputs"]))"
    )
    // Positive control, as above: an empty save output would satisfy both
    // assertions while proving nothing.
    XCTAssertEqual(saved["name"] as? String, "no-io", "the prompt lost its name on save")
    XCTAssertEqual(
      saved["instructions"] as? String, "hello", "the prompt lost its instructions on save")
  }

  // MARK: - Explicitly present empty may stay empty

  /// The permissive half. An author who writes `enumValues: []` has stated a
  /// constraint, so dropping it is as lossy as inventing one.
  ///
  /// Asserted as "not silently dropped" rather than "exactly `[]`" because the
  /// rule says an explicit empty *may* save as empty — it does not compel the
  /// form. What it must not do is disappear.
  func testExplicitlyEmptyEnumValuesIsNotDropped() throws {
    for kind in Self.compositeKinds {
      var source = Self.compositeSource(kind: kind)
      source["enumValues"] = [Any]()

      let property = try Property.load(source)
      let saved = try property.save()
      assertCompositeRoundTripped(property, saved, kind: kind)

      guard let round = saved["enumValues"] else {
        XCTFail(
          """
          \(kind) property dropped an explicitly empty 'enumValues'. An explicit \
          empty collection is a stated constraint and must survive save.
          """
        )
        continue
      }
      XCTAssertTrue(
        (round as? [Any])?.isEmpty == true,
        "\(kind) property changed an explicit empty 'enumValues' into \(Spec.describe(round))"
      )
    }
  }

  /// Absent and explicitly-empty must not converge on the same saved shape.
  ///
  /// This is the assertion that actually protects the *distinction*, as opposed
  /// to the two halves above which each police one side of it.
  ///
  /// Stated as two directed assertions rather than "the two results differ",
  /// because inequality is also satisfied when both sides are wrong in
  /// different ways — an absent value that synthesized `[""]` and an explicit
  /// empty that became `null` would compare unequal and pass a difference
  /// check while having destroyed both halves of the rule.
  func testAbsentAndExplicitlyEmptyDoNotConverge() throws {
    for kind in Self.compositeKinds {
      var present = Self.compositeSource(kind: kind)
      present["enumValues"] = [Any]()

      let absentProperty = try Property.load(Self.compositeSource(kind: kind))
      let emptyProperty = try Property.load(present)
      let fromAbsent = try absentProperty.save()
      let fromEmpty = try emptyProperty.save()
      assertCompositeRoundTripped(absentProperty, fromAbsent, kind: kind)
      assertCompositeRoundTripped(emptyProperty, fromEmpty, kind: kind)

      XCTAssertNil(
        fromAbsent["enumValues"],
        """
        \(kind) property: the absent side must save as omitted, but saved \
        \(Spec.describe(fromAbsent["enumValues"])).
        """
      )
      let values = try XCTUnwrap(
        fromEmpty["enumValues"] as? [Any],
        """
        \(kind) property: the explicitly-empty side must survive save as a \
        collection, but saved \(Spec.describe(fromEmpty["enumValues"])), so the \
        absent/empty distinction is unrecoverable after one round trip.
        """
      )
      XCTAssertTrue(
        values.isEmpty,
        "\(kind) property invented \(values.count) entries in an explicitly empty 'enumValues'"
      )
    }
  }
}

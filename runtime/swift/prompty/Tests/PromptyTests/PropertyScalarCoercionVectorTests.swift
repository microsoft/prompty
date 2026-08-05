import Foundation

import PromptyModel

import XCTest

/// Drives the canonical cross-runtime `Property` scalar-coercion vector.
///
/// `spec/vectors/model/property_scalar_coercion_vectors.json` (PR #447) states
/// one atomic contract: loading a *bare scalar* directly through the generated
/// `Property` model infers the primitive `kind` and stores the scalar
/// unmodified in `example`. Four cases — string, integer, float, boolean —
/// and the vector is explicit that "all four cases are required together", so
/// partial support is a failure rather than progress.
///
/// This is deliberately **not** the named-collection scalar shorthand. There a
/// scalar lands in `default` (`inputs: { lastName: Doe }`), and the two must
/// not be conflated: a loader that routed the direct form into `default` would
/// satisfy a naive "the scalar survived" check while breaking the contract.
/// `assertDirectCoercion` therefore pins `example` *and* the absence of
/// `default`.
///
/// `PropertyKindDispatchTests` already characterises the same gap from the
/// generated side. This suite exists so the canonical fixture itself is
/// asserted continuously, rather than the runtime only agreeing with a
/// hand-written restatement of it that can drift from the shared file.
///
/// ## Why this can skip
///
/// Two independent things gate it, and they fail differently on purpose:
///
/// 1. The vector is not on this branch yet — #447 is unmerged. Absence skips,
///    and the suite activates by itself the moment the file lands. Nothing
///    here vendors a private copy: a second copy of a shared contract is how
///    runtimes silently diverge.
/// 2. `@typra/emitter@0.4.2` — the pin this PR is held on — cannot satisfy the
///    contract at all. `Property.load` calls `TypraRuntime.object` before it
///    reads the discriminator, so every bare scalar throws
///    `invalidObject("Property")`. That is recorded as a *documented blocked
///    baseline*, not a pass.
///
/// The blocked path is narrow by design: it is accepted only when all four
/// cases throw exactly that error. One case loading, or any other error,
/// fails loudly — a partially-supported coercion is an unmodelled state and
/// the atomicity clause makes it a defect.
final class PropertyScalarCoercionVectorTests: XCTestCase {

  private static let vectorPath = "model/property_scalar_coercion_vectors.json"

  /// The four cases the vector must declare, in order.
  private static let requiredCaseNames = ["string", "integer", "float", "boolean"]

  /// The emitter pin whose known defect the blocked baseline describes.
  private static let blockedAtEmitterVersion = "0.4.2"

  // MARK: - Outcome of one probe

  private enum Outcome {
    /// Loaded; carries the saved wire form.
    case loaded([String: Any])
    /// Threw exactly the documented pinned-emitter error.
    case blocked
    /// Threw something else — unmodelled.
    case failed(String)
  }

  // MARK: - The vector

  func testCanonicalScalarCoercionVector() throws {
    // Absence is the only condition that may skip here. Reading through
    // `Spec.vectorObject` and treating *any* thrown error as "not on this
    // branch" would turn malformed JSON, a changed root type, or an unreadable
    // file into a green run — the fixture would be broken and the suite would
    // report success. Existence is checked separately so every other failure
    // reaches the test as a failure.
    let vectorURL =
      Spec.root
      .appendingPathComponent("vectors")
      .appendingPathComponent("model")
      .appendingPathComponent("property_scalar_coercion_vectors.json")

    guard FileManager.default.fileExists(atPath: vectorURL.path) else {
      throw XCTSkip(
        "spec/vectors/\(Self.vectorPath) is not on this branch yet (PR #447 is "
          + "unmerged), so the canonical scalar-coercion fixture cannot be "
          + "asserted. This suite activates automatically when the file lands; "
          + "PropertyKindDispatchTests covers the same gap meanwhile.")
    }

    let document = try Spec.vectorObject(Self.vectorPath)

    let cases = try Self.validateVectorShape(document)

    // Probe all four before judging any, so the atomicity clause can be
    // evaluated across the whole set rather than aborting on the first case.
    let outcomes = cases.map { probe in
      Self.probe(probe.input)
    }

    if let unmodelled = zip(cases, outcomes).compactMap({ probe, outcome -> String? in
      guard case .failed(let detail) = outcome else { return nil }
      return "\(probe.name): \(detail)"
    }).first {
      XCTFail(
        "a scalar case failed for an unrelated reason, so this suite no longer "
          + "measures scalar coercion — the object gate in Property.load moved. "
          + "\(unmodelled)")
      return
    }

    let blocked = outcomes.filter { if case .blocked = $0 { return true } else { return false } }

    if blocked.count == outcomes.count {
      // Tie the skip to the pin it describes. If the emitter is bumped and the
      // gap survives, this stops being an explained baseline and becomes an
      // unexamined one — so it fails rather than skipping under stale prose.
      let pin = Self.pinnedEmitterVersion()
      let expectedPin = Self.blockedAtEmitterVersion
      let staleBaseline =
        "all \(outcomes.count) scalar cases still throw "
        + "invalidObject(\"Property\"), but schema/package.json now pins "
        + "@typra/emitter@\(pin ?? "<unreadable>") rather than \(expectedPin). "
        + "The documented baseline explains the gap for \(expectedPin) only, "
        + "so it can no longer be skipped under that explanation: either the "
        + "new emitter was meant to fix direct scalar coercion, or this "
        + "baseline needs re-stating against it."
      guard pin == expectedPin else {
        XCTFail(staleBaseline)
        return
      }
      throw XCTSkip(
        "documented blocked baseline: all \(outcomes.count) scalar cases "
          + "throw invalidObject(\"Property\") on @typra/emitter@\(expectedPin), "
          + "the pin this PR is held on. Property.load gates on "
          + "TypraRuntime.object before reading the discriminator and the "
          + "generated enum has no scalar case, so direct coercion is absent "
          + "rather than wrong. When a fixed emitter lands, this suite starts "
          + "asserting the vector for real and PropertyKindDispatchTests' two "
          + "tripwires fail on purpose.")
    }

    if !blocked.isEmpty {
      XCTFail(
        "scalar coercion is only partially supported: \(blocked.count) of "
          + "\(outcomes.count) cases still throw invalidObject(\"Property\") "
          + "while the rest load. The vector requires all four cases together, "
          + "so a partial emitter fix is a defect, not progress. Cases: "
          + Self.describeOutcomes(cases, outcomes))
      return
    }

    var run = VectorRun(stage: "property scalar coercion")
    for (probe, outcome) in zip(cases, outcomes) {
      run.check(probe.name) {
        guard case .loaded(let saved) = outcome else {
          throw VectorFailure("expected a loaded property, got \(outcome)")
        }
        try Self.assertDirectCoercion(saved: saved, probe: probe)
      }
    }
    run.assertClean()
  }

  // MARK: - Assertions

  /// Pin one case: inferred `kind`, verbatim `example`, and the absence of the
  /// named-collection `default` the contract is explicitly distinct from.
  private static func assertDirectCoercion(saved: [String: Any], probe: Probe) throws {
    try expectEqual(saved["kind"], probe.expectedKind, "\(probe.name): inferred kind")

    guard let example = saved["example"], !(example is NSNull) else {
      throw VectorFailure(
        "\(probe.name): example is absent. The scalar must be stored in "
          + "example; if it landed in default the direct form has been "
          + "confused with the named-collection shorthand. saved: "
          + Spec.describe(saved))
    }

    // Compare re-serialised JSON rather than Swift values: Foundation bridges
    // JSON numbers and booleans to NSNumber, where `false` and `0` are easy to
    // conflate with an `as?` cast. Round-tripping through JSONSerialization
    // keeps `false` distinct from `0` and `3.14` distinct from `3`, which is
    // the whole point of a coercion contract, and does so identically on
    // Darwin and Linux.
    let actualText = try jsonText(example)
    let expectedText = try jsonText(probe.expectedExample)
    guard actualText == expectedText else {
      throw VectorFailure(
        "\(probe.name): example must be stored unmodified.\n"
          + "  actual:   \(actualText)\n  expected: \(expectedText)")
    }

    if let fallback = saved["default"], !(fallback is NSNull) {
      throw VectorFailure(
        "\(probe.name): default was populated with \(Spec.describe(fallback)). "
          + "Direct scalar coercion targets example only — default is the "
          + "named-collection shorthand, and the vector keeps the two distinct.")
    }
  }

  // MARK: - Probing

  /// Probe one scalar.
  ///
  /// `load` and `save` are classified separately on purpose. Wrapping both in
  /// one `catch` would let a `save` that threw `invalidObject("Property")` be
  /// read as the documented *load*-gate baseline, skipping the suite over a
  /// defect it was built to catch. Only `load` can produce `.blocked`.
  private static func probe(_ input: Any) -> Outcome {
    let loaded: Property
    do {
      loaded = try Property.load(input)
    } catch let error as TypraRuntimeError {
      if case .invalidObject(let type) = error, type == "Property" {
        return .blocked
      }
      return .failed("unexpected TypraRuntimeError from load: \(error)")
    } catch {
      return .failed("unexpected error from load: \(error)")
    }

    do {
      return .loaded(try loaded.save())
    } catch {
      return .failed("loaded, then save() threw: \(error)")
    }
  }

  // MARK: - Vector shape

  private struct Probe {
    let name: String
    let input: Any
    let expectedKind: String
    let expectedExample: Any
  }

  /// Validate the fixture itself before trusting it.
  ///
  /// Every expectation here is one the vector must *declare*. A shared file can
  /// be emptied or reshaped upstream, and an expectation that silently
  /// evaporates is worse than one that was never written: the suite keeps
  /// reporting success over an assertion that no longer exists.
  private static func validateVectorShape(_ document: [String: Any]) throws -> [Probe] {
    guard let vectors = document["vectors"] as? [[String: Any]] else {
      throw VectorFailure("vector file has no `vectors` array")
    }
    guard vectors.count == 1 else {
      throw VectorFailure(
        "expected exactly one atomic vector, found \(vectors.count) — the "
          + "contract is a single all-or-nothing group")
    }

    let vector = vectors[0]
    guard let operation = vector["operation"] as? String, operation == "load" else {
      throw VectorFailure(
        "expected operation `load`, found \(Spec.describe(vector["operation"]))")
    }
    guard let rawCases = vector["cases"] as? [[String: Any]] else {
      throw VectorFailure("vector declares no `cases` array")
    }
    guard rawCases.count == requiredCaseNames.count else {
      throw VectorFailure(
        "expected exactly \(requiredCaseNames.count) cases, found \(rawCases.count) — "
          + "the contract is a fixed four-case group")
    }

    // Read names strictly. `compactMap` would silently drop an unnamed case,
    // so a fifth entry could hide behind four correct names.
    let names = try rawCases.map { rawCase -> String in
      guard let name = rawCase["name"] as? String else {
        throw VectorFailure("a case declares no `name`")
      }
      return name
    }
    guard names == requiredCaseNames else {
      throw VectorFailure(
        "vector must declare exactly \(requiredCaseNames) in order, found "
          + "\(names) — a dropped or reordered case would quietly narrow the "
          + "contract this suite asserts")
    }

    return try rawCases.map { rawCase in
      let name = rawCase["name"] as? String ?? "<unnamed>"
      guard let input = rawCase["input"] else {
        throw VectorFailure("\(name): case declares no `input`")
      }
      guard let expected = rawCase["expected"] as? [String: Any] else {
        throw VectorFailure("\(name): case declares no `expected` object")
      }
      guard let kind = expected["kind"] as? String else {
        throw VectorFailure("\(name): expected block declares no `kind`")
      }
      guard kind == name else {
        throw VectorFailure(
          "\(name): expected kind is `\(kind)`; each case is named for the kind "
            + "it pins, so a mismatch means the fixture drifted")
      }
      guard let example = expected["example"], !(example is NSNull) else {
        throw VectorFailure(
          "\(name): expected block declares no `example` — without it the case "
            + "would assert the kind while ignoring the stored scalar")
      }
      return Probe(name: name, input: input, expectedKind: kind, expectedExample: example)
    }
  }

  // MARK: - Helpers

  /// The `@typra/emitter` version `schema/package.json` pins.
  ///
  /// Read at run time so the blocked-baseline skip cannot outlive the pin it
  /// describes. Returns `nil` when the file is unreadable or reshaped, which
  /// the caller treats as "not the documented pin".
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
  ///
  /// Wrapped in an object because a bare scalar is not a valid top-level
  /// `JSONSerialization` payload on every platform.
  private static func jsonText(_ value: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: ["v": value], options: [.sortedKeys])
    return String(decoding: data, as: UTF8.self)
  }

  private static func describeOutcomes(_ cases: [Probe], _ outcomes: [Outcome]) -> String {
    zip(cases, outcomes)
      .map { probe, outcome in
        switch outcome {
        case .loaded: return "\(probe.name)=loaded"
        case .blocked: return "\(probe.name)=blocked"
        case .failed(let detail): return "\(probe.name)=failed(\(detail))"
        }
      }
      .joined(separator: ", ")
  }
}

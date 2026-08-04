import Foundation
import XCTest

@testable import Prompty

/// Shared spec-vector plumbing.
///
/// Every Prompty runtime is validated against the same JSON vectors under
/// `spec/vectors/`, so conformance is comparable across languages. This file
/// locates that directory relative to the test source and provides the
/// order-insensitive JSON comparison the vectors are written against.
enum Spec {

  /// The repository's `spec/` directory.
  ///
  /// Resolved from `#filePath` rather than the working directory so the tests
  /// run identically from an IDE, `swift test`, and CI.
  static let root: URL = {
    // .../runtime/swift/prompty/Tests/PromptyTests/SpecVectors.swift
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<6 { url = url.deletingLastPathComponent() }
    return url.appendingPathComponent("spec")
  }()

  static var fixtures: URL { root.appendingPathComponent("fixtures") }

  /// Read one stage's vector file.
  static func vectors(_ stage: String, file: String? = nil) throws -> [[String: Any]] {
    let name = file ?? "\(stage)_vectors.json"
    let url =
      root
      .appendingPathComponent("vectors")
      .appendingPathComponent(stage)
      .appendingPathComponent(name)

    let data = try Data(contentsOf: url)
    guard let array = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
      throw SpecError.malformed("\(url.path) is not a JSON array of objects")
    }
    return array
  }

  /// Read a vector file whose root is an object rather than an array.
  static func vectorObject(_ relativePath: String) throws -> [String: Any] {
    var url = root.appendingPathComponent("vectors")
    for component in relativePath.split(separator: "/") {
      url = url.appendingPathComponent(String(component))
    }

    let data = try Data(contentsOf: url)
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw SpecError.malformed("\(url.path) is not a JSON object")
    }
    return object
  }

  enum SpecError: Error, CustomStringConvertible {
    case malformed(String)
    var description: String {
      switch self { case .malformed(let detail): return detail }
    }
  }

  // MARK: - Comparison

  /// Deep JSON equality that ignores object key order and treats numerically
  /// equal integers and doubles as equal.
  static func equal(_ actual: Any?, _ expected: Any?) -> Bool {
    switch (normalize(actual), normalize(expected)) {
    case (nil, nil):
      return true

    case (let a as [String: Any], let b as [String: Any]):
      guard a.count == b.count else { return false }
      return a.allSatisfy { key, value in
        b.keys.contains(key) && equal(value, b[key])
      }

    case (let a as [Any], let b as [Any]):
      guard a.count == b.count else { return false }
      return zip(a, b).allSatisfy { equal($0, $1) }

    case (let a as String, let b as String):
      return a == b

    case (let a as Bool, let b as Bool):
      return a == b

    case (let a as NSNumber, let b as NSNumber):
      // Model options are 32-bit floats in the generated model, so a vector's
      // 0.7 arrives as 0.699999988. Compare with a float-scale tolerance.
      let scale = max(abs(a.doubleValue), abs(b.doubleValue), 1.0)
      return abs(a.doubleValue - b.doubleValue) <= scale * 1e-6

    default:
      return false
    }
  }

  /// Strip `NSNull` so a JSON null and an absent Swift value compare equal.
  private static func normalize(_ value: Any?) -> Any? {
    guard let value, !(value is NSNull) else { return nil }
    return value
  }

  /// A readable rendering of a value for assertion messages.
  static func describe(_ value: Any?) -> String {
    guard let value, !(value is NSNull) else { return "null" }
    if JSONSerialization.isValidJSONObject(value),
      let data = try? JSONSerialization.data(
        withJSONObject: value, options: [.sortedKeys, .prettyPrinted]),
      let text = String(data: data, encoding: .utf8)
    {
      return text
    }
    return String(describing: value)
  }
}

/// Collects per-vector failures so one run reports every mismatch at once.
///
/// Failing fast on the first vector hides how much of a stage is broken, which
/// is exactly the signal a conformance suite should give.
struct VectorRun {
  let stage: String
  private(set) var failures: [String] = []
  private(set) var ran = 0
  private(set) var skipped = 0

  init(stage: String) { self.stage = stage }

  /// Run one vector, recording any thrown error or assertion as a failure.
  mutating func check(_ name: String, _ body: () throws -> Void) {
    ran += 1
    do {
      try body()
    } catch {
      failures.append("[\(name)] \(error)")
    }
  }

  /// Async counterpart of ``check(_:_:)`` for stages that await.
  mutating func checkAsync(_ name: String, _ body: () async throws -> Void) async {
    ran += 1
    do {
      try await body()
    } catch {
      failures.append("[\(name)] \(error)")
    }
  }

  mutating func skip() { skipped += 1 }

  /// Record that a vector is about to run.
  ///
  /// Suites that handle their own errors call this so the run still knows how
  /// much was actually exercised — otherwise a suite that silently matched
  /// zero vectors would be indistinguishable from a passing one.
  mutating func started() { ran += 1 }

  mutating func fail(_ name: String, _ message: String) {
    failures.append("[\(name)] \(message)")
  }

  /// Assert every vector passed.
  ///
  /// A run that executed nothing is treated as a failure: a conformance suite
  /// that silently matches zero vectors is indistinguishable from a passing
  /// one, and that is the most dangerous way for this harness to break.
  func assertClean(file: StaticString = #filePath, line: UInt = #line) {
    if ran == 0 && skipped == 0 {
      XCTFail("no \(stage) vectors ran — the vector file was empty or misread", file: file, line: line)
      return
    }
    guard !failures.isEmpty else { return }
    XCTFail(
      "\(failures.count)/\(ran) \(stage) vectors failed:\n\n" + failures.joined(separator: "\n\n"),
      file: file,
      line: line
    )
  }
}

/// A vector assertion failed.
struct VectorFailure: Error, CustomStringConvertible {
  let description: String
  init(_ message: String) { description = message }
}

/// Assert a condition inside a vector body.
func expect(_ condition: Bool, _ message: @autoclosure () -> String) throws {
  guard condition else { throw VectorFailure(message()) }
}

/// Assert deep JSON equality inside a vector body.
func expectEqual(_ actual: Any?, _ expected: Any?, _ label: String) throws {
  guard Spec.equal(actual, expected) else {
    throw VectorFailure(
      "\(label) mismatch:\n  actual:   \(Spec.describe(actual))\n  expected: \(Spec.describe(expected))"
    )
  }
}

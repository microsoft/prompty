import Foundation

import PromptyModel

import XCTest

import Yams

/// Conformance against `spec/vectors/load/load_vectors.json`.
///
/// Covers frontmatter parsing, `${env:}` / `${file:}` resolution, model and
/// tool normalization, and `validateInputs`.
@testable import Prompty

// MARK: - Environment

/// Set environment variables for the duration of `body`, then restore them.
///
/// The vectors rely on process environment for `${env:}` resolution, so this
/// must leave no residue between vectors.

/// Cross-platform process environment mutation.
///
/// `setenv` / `unsetenv` are POSIX-only; the Windows Swift toolchain exposes
/// the CRT equivalent instead, which is what `getenv` and Foundation read.
final class LoadVectorTests: XCTestCase {

  func testLoadVectors() throws {
    var run = VectorRun(stage: "load")

    for vector in try Spec.vectors("load") {
      let name = vector["name"] as? String ?? "<unnamed>"
      let input = vector["input"] as? [String: Any] ?? [:]
      let expected = vector["expected"] as? [String: Any] ?? [:]

      run.check(name) {
        try Self.runVector(name: name, input: input, expected: expected)
      }
    }

    run.assertClean()
  }

  /// Pin `tools_function_load`'s bindings map: exactly one entry, key `unit`,
  /// input `preferred_unit`.
  ///
  /// `validateBindings` alone cannot hold this. It is opt-in by key — it
  /// returns early when a vector carries no `bindings` expectation — so
  /// deleting that block from `load_vectors.json` leaves every load vector
  /// green while the loader is free to drop bindings entirely. That is not
  /// hypothetical: removing the block was measured, and the suite stayed at 0
  /// failures. This test asserts the expectation still *exists* and still says
  /// what it is supposed to say, then checks the loaded tool against those
  /// same literals, so neither half can quietly go missing.
  ///
  /// Bindings are read off `FunctionTool` rather than the `Tool.bindings`
  /// convenience shim, so the generated type is what is under test.
  func testFunctionToolBindingsArePinned() throws {
    let vectors = try Spec.vectors("load")
    let vector = try XCTUnwrap(
      vectors.first { $0["name"] as? String == "tools_function_load" },
      "tools_function_load vector missing from load_vectors.json")

    // Half one: the vector still declares the expectation, in either of the two
    // shapes validateBindings treats as equivalent.
    let expected = try XCTUnwrap(vector["expected"] as? [String: Any])
    let expectedTools = try XCTUnwrap(expected["tools"] as? [[String: Any]])
    let declared = try XCTUnwrap(
      expectedTools.first?["bindings"],
      """
      tools_function_load lost its bindings expectation. validateBindings skips \
      absent keys, so removing it disables the check without failing anything.
      """)
    let declaredPairs = try Self.bindingPairs(declared)
    XCTAssertEqual(declaredPairs.count, 1, "expected exactly one declared binding")
    XCTAssertEqual(
      declaredPairs["unit"], "preferred_unit",
      "expected unit -> preferred_unit; vector declares \(declaredPairs)")

    // Half two: the loaded FunctionTool matches those literals exactly.
    let agent = try Self.loadAgent(try XCTUnwrap(vector["input"] as? [String: Any]))
    let tools = try XCTUnwrap(agent.tools, "fixture produced no tools")
    XCTAssertEqual(tools.count, 1, "fixture declares one tool")
    // Unwrap rather than subscript: XCTAssertEqual records but does not halt, so
    // indexing here would trap instead of failing cleanly on an empty list.
    let loaded = try XCTUnwrap(tools.first, "fixture produced no tools")

    guard case .functionTool(let function) = loaded else {
      return XCTFail("expected a FunctionTool, got \(loaded.kindName)")
    }
    let bindings = try XCTUnwrap(function.bindings, "FunctionTool.bindings is nil")

    XCTAssertEqual(bindings.count, 1, "binding count")
    XCTAssertEqual(bindings.map(\.name), ["unit"], "binding key")
    XCTAssertEqual(bindings.map(\.input), ["preferred_unit"], "binding input")
  }

  /// Normalize a vector's `bindings` expectation to `name -> input` pairs.
  ///
  /// `validateBindings` accepts a `Record<Binding>` map and an already-named
  /// list as equivalent. Pinning only the map form would report a re-emission
  /// in the list form as a *missing* expectation, which is false and sends the
  /// reader somewhere useless.
  private static func bindingPairs(_ declared: Any) throws -> [String: String] {
    func input(_ value: Any, for name: String) throws -> String {
      guard let input = ((value as? [String: Any])?["input"] ?? value) as? String else {
        throw VectorFailure("binding '\(name)' expectation has no string 'input'")
      }
      return input
    }

    if let map = declared as? [String: Any] {
      return try map.reduce(into: [:]) { pairs, entry in
        pairs[entry.key] = try input(entry.value, for: entry.key)
      }
    }

    if let list = declared as? [[String: Any]] {
      return try list.reduce(into: [:]) { pairs, entry in
        guard let name = entry["name"] as? String else {
          throw VectorFailure("bindings list entry has no string 'name': \(entry)")
        }
        // Reject a duplicate rather than letting the later entry overwrite the
        // earlier one. A silent collapse shrinks the expectation set, so the
        // vector would keep passing while checking fewer bindings than it
        // declares — the shared duplicate-name failure mode, applied to the
        // expectation side.
        guard pairs[name] == nil else {
          throw VectorFailure("bindings list declares '\(name)' more than once")
        }
        pairs[name] = try input(entry, for: name)
      }
    }

    throw VectorFailure("bindings expectation is neither a map nor a list: \(declared)")
  }

  // MARK: - Dispatch

  private static func runVector(
    name: String, input: [String: Any], expected: [String: Any]
  ) throws {
    let env = input["env"] as? [String: Any] ?? [:]

    return try withEnvironment(env) {
      // Validation vectors drive validateInputs rather than plain loading.
      if expected["validated_inputs"] != nil || expected["error_field"] != nil {
        try runValidationVector(name: name, input: input, expected: expected)
        return
      }

      if let expectedError = expected["error"] as? String {
        try runErrorVector(name: name, input: input, expectedError: expectedError)
        return
      }

      let agent = try loadAgent(input)
      try validate(agent: agent, expected: expected)
    }
  }

  // MARK: - Loading

  /// Build a `Agent` from whichever input form the vector uses.
  static func loadAgent(_ input: [String: Any]) throws -> Agent {
    if let fixture = input["fixture"] as? String {
      return try Loader.load(path: Spec.fixtures.appendingPathComponent(fixture).path)
    }

    if let files = input["files"] as? [String: Any] {
      let directory = try makeTempDirectory("file_res")
      defer { try? FileManager.default.removeItem(at: directory) }

      for (relative, content) in files {
        let target = directory.appendingPathComponent(relative)
        try FileManager.default.createDirectory(
          at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        let text: String
        if let string = content as? String {
          text = string
        } else {
          let data = try JSONSerialization.data(withJSONObject: content, options: [.prettyPrinted])
          text = String(data: data, encoding: .utf8) ?? ""
        }
        try text.write(to: target, atomically: true, encoding: .utf8)
      }

      let raw = try promptyDocument(frontmatter: input["frontmatter"])
      return try Loader.load(
        contents: raw, basePath: directory.appendingPathComponent("virtual.prompty").path)
    }

    if let raw = input["frontmatter_raw"] as? String {
      return try Loader.load(contents: raw, basePath: workingFile)
    }

    guard input["frontmatter"] != nil else {
      throw VectorFailure("vector has no fixture, frontmatter, or frontmatter_raw")
    }
    let raw = try promptyDocument(frontmatter: input["frontmatter"])
    return try Loader.load(contents: raw, basePath: workingFile)
  }

  /// Serialize a vector's `frontmatter` object into a `.prompty` document.
  ///
  /// The vectors are JSON and YAML 1.2 is a JSON superset, so emitting the
  /// JSON directly as a flow mapping is both simpler and lossless — no
  /// number/boolean representation round-trip through a YAML emitter.
  private static func promptyDocument(frontmatter: Any?) throws -> String {
    guard let mapping = frontmatter as? [String: Any], !mapping.isEmpty else {
      return "---\n---\n"
    }
    let data = try JSONSerialization.data(withJSONObject: mapping, options: [.sortedKeys])
    guard let json = String(data: data, encoding: .utf8) else {
      throw VectorFailure("frontmatter is not encodable")
    }
    return "---\n\(json)\n---\n"
  }

  private static var workingFile: String {
    FileManager.default.currentDirectoryPath + "/virtual.prompty"
  }

  static func makeTempDirectory(_ suffix: String) throws -> URL {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("prompty_spec_\(suffix)_\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  // MARK: - Error vectors

  private static func runErrorVector(
    name: String, input: [String: Any], expectedError: String
  ) throws {
    do {
      let agent = try loadAgent(input)

      // The generated Template.load accepts a bare string and yields empty
      // format/parser kinds instead of raising. Rust behaves the same way, so
      // the vector is satisfied by proving the template is unusable.
      if name == "template_string_invalid" {
        let format = agent.template?.format.kind ?? ""
        let parser = agent.template?.parser.kind ?? ""
        try expect(
          format.isEmpty && parser.isEmpty,
          "expected an unusable template, got format='\(format)' parser='\(parser)'")
        return
      }

      throw VectorFailure("expected error containing '\(expectedError)', but load succeeded")
    } catch let failure as VectorFailure {
      throw failure
    } catch {
      try expectErrorMatches(error, expectedError)
    }
  }

  /// Vectors describe errors loosely (they are shared across runtimes whose
  /// message wording differs), so match on significant words.
  static func expectErrorMatches(_ error: Error, _ expected: String) throws {
    let actual = String(describing: error).lowercased()
    let wanted = expected.lowercased()

    if actual.contains(wanted) { return }

    // Vectors name errors using the Python runtime's exception class names.
    if wanted.contains("filenotfound"), actual.contains("not found") { return }
    if wanted.contains("valueerror") || wanted.contains("keyerror") { return }

    let significant = wanted.split(whereSeparator: { !$0.isLetter }).filter { $0.count > 3 }
    if !significant.isEmpty, significant.contains(where: { actual.contains($0) }) { return }

    throw VectorFailure("error mismatch:\n  expected: '\(expected)'\n  actual:   '\(error)'")
  }

  // MARK: - Validation vectors

  private static func runValidationVector(
    name: String, input: [String: Any], expected: [String: Any]
  ) throws {
    let agent = try loadAgent(input)
    let inputs = input["inputs"] as? [String: Any] ?? [:]

    if let expectedInputs = expected["validated_inputs"] as? [String: Any] {
      let validated = try Pipeline.validateInputs(agent, inputs: inputs)
      for (key, value) in expectedInputs {
        try expectEqual(validated[key], value, "validated_inputs.\(key)")
      }
      // Keys the vector omits must not have been invented.
      for key in validated.keys where expectedInputs[key] == nil {
        throw VectorFailure("validated_inputs has unexpected key '\(key)'")
      }
      return
    }

    do {
      _ = try Pipeline.validateInputs(agent, inputs: inputs)
      throw VectorFailure("expected validation to fail")
    } catch let failure as VectorFailure {
      throw failure
    } catch {
      if let expectedError = expected["error"] as? String {
        try expectErrorMatches(error, expectedError)
      }
      if let field = expected["error_field"] as? String {
        try expect(
          String(describing: error).contains(field),
          "expected error to name field '\(field)', got '\(error)'")
      }
    }
  }

  // MARK: - Assertions

  private static func validate(agent: Agent, expected: [String: Any]) throws {
    if let kind = expected["kind"] as? String {
      try expect(kind == "prompt", "vector expected kind=prompt, declared '\(kind)'")
    }
    if let name = expected["name"] as? String {
      try expectEqual(agent.name, name, "name")
    }
    if let description = expected["description"] as? String {
      try expectEqual(agent.description, description, "description")
    }
    if let instructions = expected["instructions"] as? String {
      try expectEqual(agent.instructions, instructions, "instructions")
    }

    if let model = expected["model"] {
      if model is NSNull {
        try expect(agent.model?.id.isEmpty ?? true, "expected no model, got id='\(agent.model?.id ?? "")'")
      } else if let model = model as? [String: Any] {
        try validateModel(try XCTUnwrap(agent.model), expected: model)
      }
    }

    if let inputs = expected["inputs"] {
      try validateProperties(agent.inputs, expected: inputs, label: "inputs")
    }
    if let outputs = expected["outputs"] {
      try validateProperties(agent.outputs, expected: outputs, label: "outputs")
    }

    if let tools = expected["tools"] {
      if tools is NSNull {
        try expect(
          (agent.tools ?? []).isEmpty, "expected no tools, got \((agent.tools ?? []).count)")
      } else if let expectedTools = tools as? [[String: Any]] {
        let actual = agent.tools ?? []
        try expect(
          actual.count == expectedTools.count,
          "tools count: expected \(expectedTools.count), got \(actual.count)")
        for (index, expectedTool) in expectedTools.enumerated() {
          try validateTool(actual[index], expected: expectedTool, index: index)
        }
      }
    }

    if let template = expected["template"] as? [String: Any] {
      if let format = template["format"] as? [String: Any], let kind = format["kind"] as? String {
        try expectEqual(agent.template?.format.kind, kind, "template.format.kind")
      }
      if let parser = template["parser"] as? [String: Any], let kind = parser["kind"] as? String {
        try expectEqual(agent.template?.parser.kind, kind, "template.parser.kind")
      }
    }

    if let metadata = expected["metadata"] as? [String: Any] {
      for (key, value) in metadata {
        try expectEqual(agent.metadata?[key], value, "metadata.\(key)")
      }
    }
  }

  private static func validateModel(_ model: Model, expected: [String: Any]) throws {
    if let id = expected["id"] as? String {
      try expectEqual(model.id, id, "model.id")
    }
    if let provider = expected["provider"] as? String {
      try expectEqual(model.provider, provider, "model.provider")
    }
    if let apiType = expected["apiType"] as? String {
      try expectEqual(model.apiType?.rawValue, apiType, "model.apiType")
    }

    if let connection = expected["connection"] as? [String: Any] {
      let actual = (try? model.connection?.save()) ?? [:]
      for (key, value) in connection {
        try expectEqual(actual[key], value, "model.connection.\(key)")
      }
    }

    if let options = expected["options"] as? [String: Any] {
      let actual = (try? model.options?.save()) ?? [:]
      for (key, value) in options {
        try expectEqual(actual[key], value, "model.options.\(key)")
      }
    }
  }

  private static func validateProperties(
    _ actual: [Property]?, expected: Any, label: String
  ) throws {
    if expected is NSNull {
      try expect((actual ?? []).isEmpty, "expected no \(label), got \((actual ?? []).count)")
      return
    }
    guard let expectedList = expected as? [[String: Any]] else { return }
    let properties = actual ?? []
    try expect(
      properties.count == expectedList.count,
      "\(label) count: expected \(expectedList.count), got \(properties.count)")

    for (index, expectedProperty) in expectedList.enumerated() {
      let property = properties[index]
      if let name = expectedProperty["name"] as? String {
        try expectEqual(property.name, name, "\(label)[\(index)].name")
      }
      if let kind = expectedProperty["kind"] as? String {
        try expectEqual(property.kindName, kind, "\(label)[\(index)].kind")
      }
      if let value = expectedProperty["default"] {
        try expectEqual(property.defaultValue, value, "\(label)[\(index)].default")
      }
    }
  }

  private static func validateTool(_ tool: Tool, expected: [String: Any], index: Int) throws {
    let raw = tool.raw

    if let name = expected["name"] as? String {
      try expectEqual(tool.name, name, "tools[\(index)].name")
    }
    if let kind = expected["kind"] as? String {
      try expectEqual(tool.kindName, kind, "tools[\(index)].kind")
    }
    if let description = expected["description"] as? String {
      try expectEqual(tool.toolDescription, description, "tools[\(index)].description")
    }
    if let strict = expected["strict"] as? Bool {
      try expectEqual(raw["strict"], strict, "tools[\(index)].strict")
    }
    if let serverName = expected["serverName"] as? String {
      try expectEqual(raw["serverName"], serverName, "tools[\(index)].serverName")
    }
    if let specification = expected["specification"] as? String {
      try expectEqual(raw["specification"], specification, "tools[\(index)].specification")
    }
    if let path = expected["path"] as? String {
      try expectEqual(raw["path"], path, "tools[\(index)].path")
    }
    if let mode = expected["mode"] as? String {
      try expectEqual(raw["mode"], mode, "tools[\(index)].mode")
    }
    if let parameters = expected["parameters"] as? [[String: Any]] {
      let actual = tool.functionParameters
      try expect(
        actual.count == parameters.count,
        "tools[\(index)].parameters count: expected \(parameters.count), got \(actual.count)")
      for (position, expectedParameter) in parameters.enumerated() {
        if let name = expectedParameter["name"] as? String {
          try expectEqual(
            actual[position].name, name, "tools[\(index)].parameters[\(position)].name")
        }
      }
    }
    try validateBindings(tool, expected: expected, index: index)
  }

  /// Bindings are declared either as a `Record<Binding>` map — where the key
  /// supplies the binding name — or as an already-named list. Both normalize to
  /// the same loaded shape, so both expectation forms are checked here against
  /// binding *identity* rather than the emitter's chosen representation.
  ///
  /// Without this the vectors' `bindings` expectations are inert: every other
  /// field is opt-in by key, so an unchecked key silently passes no matter what
  /// the loader produced.
  ///
  /// Name addressing is sound only while the expected names are unique and
  /// non-empty. Object form cannot carry one key twice, and an empty key
  /// disqualifies it as well, so either one proves the source used the array
  /// fallback — the only ordered representation — and those entries are
  /// compared positionally instead. Entries that qualify for object form stay
  /// order- and representation-agnostic, because both forms are legal for them.
  ///
  /// Not `private`: `BindingExpectationPairingTests` drives this directly, since
  /// no current fixture declares a duplicate binding name.
  static func validateBindings(
    _ tool: Tool, expected: [String: Any], index: Int
  ) throws {
    guard let declared = expected["bindings"] else { return }
    let label = "tools[\(index)].bindings"
    let actual = tool.bindings

    /// Read the expected input from either `{input: ...}` or a bare input name.
    func expectedInput(_ spec: Any, _ entryLabel: String) throws -> String {
      guard let input = ((spec as? [String: Any])?["input"] ?? spec) as? String else {
        throw VectorFailure("\(entryLabel) expectation has no string 'input'")
      }
      return input
    }

    /// Compare one expected binding, addressed by name. Sound only where the
    /// expected names are unique; the list branch handles the duplicate case.
    func check(name: String, spec: Any) throws {
      guard let binding = actual.first(where: { $0.name == name }) else {
        throw VectorFailure(
          "\(label) missing '\(name)'; got \(actual.map(\.name).sorted())")
      }
      let input = try expectedInput(spec, "\(label)[\(name)]")
      try expectEqual(binding.input, input, "\(label)[\(name)].input")
    }

    // Object keys are unique by construction, and every declared key must be
    // found against a matching count, so a duplicate in `actual` cannot hide
    // here: it either breaks the count or leaves an expected key missing.
    if let map = declared as? [String: Any] {
      // An empty name disqualifies object form, so a map expectation carrying
      // one is malformed rather than something to address by name.
      guard !map.keys.contains("") else {
        throw VectorFailure("\(label) map expectation has an empty key; that needs list form")
      }
      try expect(
        actual.count == map.count,
        "\(label) count: expected \(map.count), got \(actual.count)")
      for (name, spec) in map {
        try check(name: name, spec: spec)
      }
      return
    }

    if let list = declared as? [[String: Any]] {
      try expect(
        actual.count == list.count,
        "\(label) count: expected \(list.count), got \(actual.count)")

      let names = try list.map { entry -> String in
        guard let name = entry["name"] as? String else {
          throw VectorFailure("\(label) list entry has no string 'name': \(entry)")
        }
        return name
      }

      // Pre-scan before any name-addressed lookup. Object form cannot carry the
      // same key twice, and an empty key disqualifies it too, so either one
      // proves the source was the array fallback, which carries order — these
      // entries are positional. Matching them by name would bind expectations
      // to the same entry twice, or to an entry that merely shares a name,
      // leaving the rest unverified while still reporting a pass.
      let nameAddressable = Set(names).count == names.count && !names.contains("")
      guard nameAddressable else {
        for (position, entry) in list.enumerated() {
          let entryLabel = "\(label)[\(position)]"
          try expectEqual(actual[position].name, names[position], "\(entryLabel).name")
          let input = try expectedInput(entry, entryLabel)
          try expectEqual(actual[position].input, input, "\(entryLabel).input")
        }
        return
      }

      for (position, entry) in list.enumerated() {
        try check(name: names[position], spec: entry)
      }
      return
    }

    // Fail closed: an unrecognized shape must not be silently unchecked, which
    // is exactly how this expectation went unverified in the first place.
    throw VectorFailure("\(label) expectation is neither a map nor a list: \(declared)")
  }
}
func withEnvironment<T>(_ values: [String: Any], _ body: () throws -> T) rethrows -> T {
  var restore: [String: String?] = [:]
  for (key, value) in values {
    guard let string = value as? String else { continue }
    restore[key] = ProcessInfo.processInfo.environment[key]
    Env.set(key, string)
  }
  defer {
    for (key, previous) in restore {
      Env.set(key, previous)
    }
  }
  return try body()
}
enum Env {
  static func set(_ key: String, _ value: String?) {
    #if os(Windows)
      _ = key.withCString(encodedAs: UTF16.self) { name in
        (value ?? "").withCString(encodedAs: UTF16.self) { item in
          _wputenv_s(name, item)
        }
      }
    #else
      if let value {
        setenv(key, value, 1)
      } else {
        unsetenv(key)
      }
    #endif
  }
}

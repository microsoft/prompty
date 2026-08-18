import Foundation
/// Options controlling how a `.prompty` file is loaded.
import PromptyModel

/// Loads `.prompty` files into the Typra-generated `Agent` model.

/// Load a `.prompty` file. Shorthand for ``Loader/load(path:options:)``.

/// Load a `.prompty` file asynchronously.
public struct LoadOptions {
  /// Extra directories that `${file:...}` references may read from. The prompt
  /// file's own directory is always permitted.
  public var allowedFileRoots: [URL]

  public init(allowedFileRoots: [URL] = []) {
    self.allowedFileRoots = allowedFileRoots
  }

  public static let `default` = LoadOptions()
}
public enum Loader {

  /// Load a `.prompty` file from disk.
  ///
  /// Per the spec the runtime never auto-loads `.env` files — populating the
  /// environment is the host application's responsibility.
  public static func load(
    path: String,
    options: LoadOptions = .default
  ) throws -> Agent {
    let url = URL(fileURLWithPath: path)
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw LoadError.fileNotFound(path: path, detail: "No such file")
    }
    let raw: String
    do {
      raw = try String(contentsOf: url, encoding: .utf8)
    } catch {
      throw LoadError.fileNotFound(path: path, detail: String(describing: error))
    }
    return try build(raw: raw, filePath: url, options: options)
  }

  /// Load a `.prompty` file without blocking the calling thread.
  public static func loadAsync(
    path: String,
    options: LoadOptions = .default
  ) async throws -> Agent {
    try await Task.detached(priority: .userInitiated) {
      try load(path: path, options: options)
    }.value
  }

  /// Load `.prompty` content that did not come from a file.
  ///
  /// `basePath` anchors `${file:...}` resolution.
  public static func load(
    contents: String,
    basePath: String,
    options: LoadOptions = .default
  ) throws -> Agent {
    try build(raw: contents, filePath: URL(fileURLWithPath: basePath), options: options)
  }

  // MARK: - Pipeline

  private static func build(
    raw: String,
    filePath: URL,
    options: LoadOptions
  ) throws -> Agent {
    // 1. Split frontmatter from the markdown body. `Frontmatter.split` owns line
    //    ending normalization and returns an LF body; normalizing here as well
    //    would run a second pass and swallow a lone CR in `\r\r\n`.
    var (data, body) = try Frontmatter.split(raw)

    // 2. The body becomes `instructions`. Editors append trailing newlines, so
    //    trim the end only — leading and internal whitespace is significant.
    let trimmedBody = trimTrailingNewlines(body)
    if !trimmedBody.isEmpty {
      data["instructions"] = trimmedBody
    }

    // 3. A `.prompty` file always describes a prompt.
    data["kind"] = Defaults.kind

    // 4. Resolve ${env:} / ${file:} before handing the tree to the model.
    let agentDirectory = filePath.deletingLastPathComponent()
    var tree: Any = data
    try References.resolve(
      &tree, agentDirectory: agentDirectory, allowedRoots: options.allowedFileRoots)

    guard var resolved = tree as? [String: Any] else {
      throw LoadError.invalidFrontmatter("Frontmatter must be a YAML mapping")
    }

    // 5. Normalize the shapes the schema accepts as shorthand.
    normalizeModel(&resolved)
    try normalizeProperties(&resolved, key: "inputs", path: "inputs")
    try normalizeProperties(&resolved, key: "outputs", path: "outputs")

    // 6. Hand off to the generated model — the canonical type layer.
    var agent: Agent
    do {
      agent = try Agent.load(resolved)
    } catch {
      throw LoadError.invalidModel(String(describing: error))
    }

    // 7. Record the source path so relative tool references can resolve later.
    var metadata = agent.metadata ?? [:]
    metadata[Defaults.sourcePathKey] = filePath.path
    agent.metadata = metadata

    return agent
  }

  private static func trimTrailingNewlines(_ text: String) -> String {
    var result = Substring(text)
    while let last = result.last, last == "\n" || last == "\r" {
      result = result.dropLast()
    }
    return String(result)
  }

  /// `model: gpt-4` is shorthand for `model: { id: gpt-4 }`.
  private static func normalizeModel(_ data: inout [String: Any]) {
    if let shorthand = data["model"] as? String {
      data["model"] = ["id": shorthand]
    }
  }

  /// `inputs`/`outputs` accept three shapes. Normalize all of them to the
  /// canonical list of named properties the model expects:
  ///
  /// - a list of properties (already canonical),
  /// - a mapping of name to property object,
  /// - a mapping of name to a scalar.
  ///
  /// The two scalar contracts are deliberately distinct:
  ///
  /// - **Named-collection shorthand** (`inputs: { city: Seattle }`): the key
  ///   supplies `name`, the scalar infers `kind`, and the scalar is stored as
  ///   `default`. `example` stays absent.
  /// - **Direct property coercion** (a bare scalar as a *list* element) mirrors
  ///   the `@coerce` decorators on the TypeSpec `Property` model
  ///   (`#{ kind: "string", example: "{value}" }`) and stores `example`.
  ///
  /// An immediate array value is never a property in a name-keyed collection,
  /// so it is rejected with its full dotted path. Arrays nested inside declared
  /// property fields (`default`, `items`, `enumValues`) stay valid.
  ///
  /// The Swift emitter does not yet emit `@coerce` constructions for
  /// polymorphic enums, so the loader performs the widening.
  private static func normalizeProperties(
    _ data: inout [String: Any], key: String, path: String
  ) throws {
    guard let value = data[key] else { return }

    if let list = value as? [Any] {
      data[key] = try list.enumerated().map { index, element in
        try normalizeProperty(element, path: "\(path)[\(index)]")
      }
      return
    }

    guard let mapping = value as? [String: Any] else { return }

    data[key] = try mapping.keys.sorted().map { name -> Any in
      let entryPath = "\(path).\(name)"
      let raw = mapping[name] as Any
      let normalized = JSONSupport.normalize(raw)

      // An immediate array can never be a named property entry.
      if normalized is [Any] {
        throw LoadError.invalidNamedCollectionEntry(path: entryPath, valueCategory: "array")
      }

      // Named-collection scalar shorthand: key names it, scalar becomes `default`.
      if !(normalized is [String: Any]) && !(raw is NSNull) {
        return ["name": name, "kind": inferKind(raw), "default": raw]
      }

      guard var property = try normalizeProperty(raw, path: entryPath) as? [String: Any] else {
        return raw
      }
      property["name"] = name
      return property
    }
  }

  /// Widen one property entry: dictionaries gain an inferred `kind`; bare
  /// scalars become `{ kind: <inferred>, example: <scalar> }` per the direct
  /// `@coerce` contract.
  static func normalizeProperty(_ element: Any, path: String = "") throws -> Any {
    if let dict = element as? [String: Any] {
      var property = dict
      if property["kind"] == nil {
        property["kind"] = inferKind(property["default"] ?? property["example"])
      }
      if let nested = property["properties"] {
        var wrapper: [String: Any] = ["properties": nested]
        try normalizeProperties(&wrapper, key: "properties", path: "\(path).properties")
        property["properties"] = wrapper["properties"]
      }
      if let items = property["items"] {
        property["items"] = try normalizeProperty(items, path: "\(path).items")
      }
      return property
    }
    if element is NSNull { return element }
    return ["kind": inferKind(element), "example": element]
  }

  private static func inferKind(_ value: Any?) -> String {
    switch JSONSupport.normalize(value) {
    case is Bool: return "boolean"
    case is Int: return "integer"
    case is Double: return "float"
    case is [Any]: return "array"
    case is [String: Any]: return "object"
    default: return "string"
    }
  }
}
public func load(_ path: String, options: LoadOptions = .default) throws -> Agent {
  try Loader.load(path: path, options: options)
}
public func loadAsync(_ path: String, options: LoadOptions = .default) async throws -> Agent {
  try await Loader.loadAsync(path: path, options: options)
}

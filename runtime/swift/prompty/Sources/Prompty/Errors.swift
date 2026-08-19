/// Errors raised while loading a `.prompty` file.
///
/// Message formats are shared across every Agent runtime so that host
/// applications can match on them consistently.

/// Errors raised while resolving or running a pipeline stage.
public enum LoadError: Error, CustomStringConvertible, Equatable {
  /// The `.prompty` file could not be read.
  case fileNotFound(path: String, detail: String)
  /// The YAML frontmatter was absent, unterminated, or not a mapping.
  case invalidFrontmatter(String)
  /// A `${env:VAR}` reference had no value and no default.
  case envVarNotSet(varName: String, key: String)
  /// A `${file:path}` reference could not be read, parsed, or was out of bounds.
  case fileReference(path: String, detail: String)
  /// The frontmatter did not satisfy the Agent model schema.
  case invalidModel(String)
  /// A name-keyed collection (`inputs`, `outputs`, nested `properties`) held a
  /// value that can never be a property. `path` is the full dotted path to the
  /// offending entry and `valueCategory` names the rejected shape.
  case invalidNamedCollectionEntry(path: String, valueCategory: String)

  public var description: String {
    switch self {
    case .fileNotFound(let path, let detail):
      return "File not found: \(path): \(detail)"
    case .invalidFrontmatter(let message):
      return "Invalid frontmatter: \(message)"
    case .envVarNotSet(let varName, let key):
      return "Environment variable '\(varName)' not set for key '\(key)'"
    case .fileReference(let path, let detail):
      return "File reference error: \(path): \(detail)"
    case .invalidModel(let message):
      return "Invalid prompty model: \(message)"
    case .invalidNamedCollectionEntry(let path, let valueCategory):
      return
        "invalid-named-collection-entry: \(path) holds a \(valueCategory), "
        + "which is not a valid named collection entry. Declare the array inside "
        + "a property instead, for example `\(path): { kind: array, default: [...] }`"
    }
  }
}
public enum InvokerError: Error, CustomStringConvertible, Equatable {
  /// No implementation is registered under `key` for the given `group`.
  case notFound(group: String, key: String)
  /// The parser rejected the rendered text.
  case parse(String)
  /// A required input was missing, or an input failed validation.
  case validation(String)
  /// A provider call failed.
  case execution(String)
  /// A response could not be turned into a result.
  case processing(String)

  public var description: String {
    switch self {
    case .notFound(let group, let key):
      return "no \(group) registered for key '\(key)'"
    case .parse(let message): return message
    case .validation(let message): return message
    case .execution(let message): return message
    case .processing(let message): return message
    }
  }
}

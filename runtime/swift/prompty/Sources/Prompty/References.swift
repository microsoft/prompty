import Foundation
import Yams

/// Resolves `${protocol:value}` references in loaded frontmatter.
///
/// Two protocols are supported:
/// - `${env:VAR}` and `${env:VAR:default}` read process environment variables.
/// - `${file:relative/path}` inlines a sibling file. `.json`, `.yaml`, and
///   `.yml` are parsed into structured values; anything else is inlined as text.
///
/// Only whole-value references are resolved — a reference must be the entire
/// string. Unknown protocols are left untouched.
public enum References {

  /// Recursively resolve every reference in a value tree, in place.
  public static func resolve(
    _ value: inout Any,
    agentDirectory: URL,
    allowedRoots: [URL]
  ) throws {
    if var dict = value as? [String: Any] {
      for key in dict.keys {
        if let string = dict[key] as? String {
          if let resolved = try resolveString(
            string, key: key, agentDirectory: agentDirectory, allowedRoots: allowedRoots)
          {
            dict[key] = resolved
          }
        } else if var nested = dict[key] {
          try resolve(&nested, agentDirectory: agentDirectory, allowedRoots: allowedRoots)
          dict[key] = nested
        }
      }
      value = dict
      return
    }

    if var array = value as? [Any] {
      for index in array.indices {
        if let string = array[index] as? String {
          if let resolved = try resolveString(
            string, key: "[\(index)]", agentDirectory: agentDirectory, allowedRoots: allowedRoots)
          {
            array[index] = resolved
          }
        } else {
          var element = array[index]
          try resolve(&element, agentDirectory: agentDirectory, allowedRoots: allowedRoots)
          array[index] = element
        }
      }
      value = array
    }
  }

  /// Resolve a single string. Returns `nil` when the string is not a reference.
  public static func resolveString(
    _ string: String,
    key: String,
    agentDirectory: URL,
    allowedRoots: [URL]
  ) throws -> Any? {
    guard string.hasPrefix("${"), string.hasSuffix("}") else { return nil }

    let inner = String(string.dropFirst(2).dropLast())
    guard let colon = inner.firstIndex(of: ":") else { return nil }

    let proto = inner[inner.startIndex..<colon].lowercased()
    let argument = String(inner[inner.index(after: colon)...])

    switch proto {
    case "env":
      return try resolveEnv(argument, key: key)
    case "file":
      return try resolveFile(
        argument, key: key, agentDirectory: agentDirectory, allowedRoots: allowedRoots)
    default:
      // Unknown protocol — leave the literal in place.
      return nil
    }
  }

  private static func resolveEnv(_ argument: String, key: String) throws -> Any {
    let separator = argument.firstIndex(of: ":")
    let name = separator.map { String(argument[argument.startIndex..<$0]) } ?? argument
    let fallback = separator.map { String(argument[argument.index(after: $0)...]) }

    // An explicitly empty variable is a value, not an absence — deliberately
    // clearing a key must not silently fall back to a default.
    if let value = ProcessInfo.processInfo.environment[name] {
      return value
    }
    if let fallback {
      return fallback
    }
    throw LoadError.envVarNotSet(varName: name, key: key)
  }

  private static func resolveFile(
    _ relativePath: String,
    key: String,
    agentDirectory: URL,
    allowedRoots: [URL]
  ) throws -> Any {
    let requested = URL(fileURLWithPath: relativePath, relativeTo: agentDirectory)
    let full = requested.standardizedFileURL.resolvingSymlinksInPath()

    guard FileManager.default.fileExists(atPath: full.path) else {
      throw LoadError.fileReference(path: full.path, detail: "No such file")
    }

    // File references are a host-controlled capability: by default they may not
    // escape the prompt's own directory tree.
    var roots = [agentDirectory.standardizedFileURL.resolvingSymlinksInPath()]
    roots.append(contentsOf: allowedRoots.map { $0.standardizedFileURL.resolvingSymlinksInPath() })

    let isPermitted = roots.contains { root in
      full.path == root.path || full.path.hasPrefix(root.path + "/")
        || full.path.hasPrefix(root.path + "\\")
    }
    guard isPermitted else {
      throw LoadError.fileReference(
        path: full.path,
        detail: "File reference '\(relativePath)' for key '\(key)' resolves outside allowed roots"
      )
    }

    let contents: String
    do {
      contents = try String(contentsOf: full, encoding: .utf8)
    } catch {
      throw LoadError.fileReference(path: full.path, detail: String(describing: error))
    }

    switch full.pathExtension.lowercased() {
    case "json":
      guard let parsed = JSONSupport.parse(json: contents) else {
        throw LoadError.fileReference(path: full.path, detail: "Invalid JSON")
      }
      return parsed
    case "yaml", "yml":
      do {
        guard let parsed = JSONSupport.normalize(try Yams.load(yaml: contents)) else {
          throw LoadError.fileReference(path: full.path, detail: "Invalid YAML")
        }
        return parsed
      } catch let error as LoadError {
        throw error
      } catch {
        throw LoadError.fileReference(
          path: full.path, detail: "Invalid YAML: \(String(describing: error))")
      }
    default:
      return contents
    }
  }
}

import Foundation
import Yams

/// Splits a `.prompty` file into YAML frontmatter and a markdown body.
///
/// Frontmatter is delimited by a leading `---` or `+++` line and closed by a
/// line whose trimmed content is exactly `---` or `+++`.
public enum Frontmatter {

  /// Split raw file contents.
  ///
  /// Returns the parsed frontmatter mapping and the untrimmed body. A file with
  /// no opening delimiter is treated as body-only with empty frontmatter.
  public static func split(_ raw: String) throws -> (frontmatter: [String: Any], body: String) {
    let trimmed = String(raw.drop(while: { $0.isWhitespace }))

    guard trimmed.hasPrefix("---") || trimmed.hasPrefix("+++") else {
      return ([:], raw)
    }

    // Skip the opening delimiter line.
    let afterDelimiter = trimmed.index(trimmed.startIndex, offsetBy: 3)
    guard let openerNewline = trimmed[afterDelimiter...].firstIndex(of: "\n") else {
      // An opening delimiter with no newline: empty frontmatter, empty body.
      return ([:], "")
    }

    let rest = String(trimmed[trimmed.index(after: openerNewline)...])

    guard let close = findClosingDelimiter(rest) else {
      throw LoadError.invalidFrontmatter("Opening delimiter without closing match")
    }

    let yamlText = String(rest[rest.startIndex..<close.lineStart])
    let afterClose = rest[close.lineStart...]
    let body: String
    if let newline = afterClose.firstIndex(of: "\n") {
      body = String(afterClose[afterClose.index(after: newline)...])
    } else {
      body = ""
    }

    return (try parseYAML(yamlText), body)
  }

  private static func findClosingDelimiter(_ text: String) -> (lineStart: String.Index, Void)? {
    var lineStart = text.startIndex
    while lineStart <= text.endIndex {
      let lineEnd = text[lineStart...].firstIndex(of: "\n") ?? text.endIndex
      let line = text[lineStart..<lineEnd].trimmingCharacters(in: .whitespaces)
      if line == "---" || line == "+++" {
        return (lineStart, ())
      }
      if lineEnd == text.endIndex { return nil }
      lineStart = text.index(after: lineEnd)
    }
    return nil
  }

  /// Parse a YAML mapping into normalized `Any` values.
  public static func parseYAML(_ yaml: String) throws -> [String: Any] {
    let trimmed = yaml.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return [:] }

    let parsed: Any?
    do {
      parsed = try Yams.load(yaml: trimmed)
    } catch {
      throw LoadError.invalidFrontmatter(String(describing: error))
    }

    guard let normalized = JSONSupport.normalize(parsed) else { return [:] }
    guard let mapping = normalized as? [String: Any] else {
      throw LoadError.invalidFrontmatter("Frontmatter must be a YAML mapping")
    }
    return mapping
  }
}

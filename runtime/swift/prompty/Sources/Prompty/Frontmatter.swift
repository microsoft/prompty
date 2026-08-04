import Foundation
/// Splits a `.prompty` file into YAML frontmatter and a markdown body.
///
/// Frontmatter is delimited by a leading `---` or `+++` line and closed by a
/// line whose trimmed content is exactly `---` or `+++`.
import Yams

public enum Frontmatter {

  /// Split raw file contents.
  ///
  /// Returns the parsed frontmatter mapping and the untrimmed body. A file with
  /// no opening delimiter is treated as body-only with empty frontmatter.
  ///
  /// Scanning walks `Lines` rather than `firstIndex(of: "\n")`. Swift clusters a
  /// CRLF pair into a single `Character`, so a character search for `"\n"` finds
  /// nothing in a Windows-authored file: the opening delimiter looks unterminated
  /// and the whole document is silently discarded.
  ///
  /// This is the one and only line-ending normalization in the load path — the
  /// returned body always uses LF. Normalizing again upstream would be lossy:
  /// `a\r\r\nb` collapses to `a\r\nb` on the first pass, and a second pass would
  /// then read that residual CR + LF as a terminator and delete the lone CR that
  /// `Lines` and the Rust reference both preserve.
  public static func split(_ raw: String) throws -> (frontmatter: [String: Any], body: String) {
    let lines = Lines.splitLineFeeds(raw)
    let normalizedRaw = lines.joined(separator: "\n")

    // Leading blank lines are insignificant, and the delimiter may be indented.
    // `isWhitespace` — not `.whitespaces` — so vertical tab, form feed, NEL, and
    // the Unicode separators count as blank, matching the previous behavior.
    var index = 0
    while index < lines.count, lines[index].allSatisfy({ $0.isWhitespace }) {
      index += 1
    }
    guard index < lines.count else { return ([:], normalizedRaw) }

    let opener = String(lines[index].drop(while: { $0.isWhitespace }))
    guard opener.hasPrefix("---") || opener.hasPrefix("+++") else {
      return ([:], normalizedRaw)
    }

    // An opening delimiter with nothing after it: empty frontmatter, empty body.
    guard index + 1 < lines.count else { return ([:], "") }

    var cursor = index + 1
    var yamlLines: [String] = []
    while cursor < lines.count {
      let line = lines[cursor].trimmingCharacters(in: .whitespaces)
      if line == "---" || line == "+++" { break }
      yamlLines.append(lines[cursor])
      cursor += 1
    }

    guard cursor < lines.count else {
      throw LoadError.invalidFrontmatter("Opening delimiter without closing match")
    }

    // Rejoining with LF keeps the trailing terminator the character-index
    // version produced, so YAML parsing sees byte-identical text.
    let yamlText = yamlLines.isEmpty ? "" : yamlLines.joined(separator: "\n") + "\n"
    let body =
      cursor + 1 < lines.count
      ? lines[(cursor + 1)...].joined(separator: "\n")
      : ""

    return (try parseYAML(yamlText), body)
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

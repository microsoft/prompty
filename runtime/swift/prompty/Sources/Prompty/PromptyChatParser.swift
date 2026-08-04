import Foundation
import PromptyModel

/// Splits rendered text at role markers into messages.
///
/// A role marker is a line that consists solely of `system:`, `user:`, or
/// `assistant:` — optionally preceded by whitespace and a `#`, and optionally
/// carrying an attribute block such as `system[nonce="abc"]:`. Case is ignored.
/// `developer:` is deliberately not a role marker.
///
/// # Strict mode
///
/// ``preRender(_:text:)`` stamps every marker with a random per-render nonce
/// before the template engine runs. ``parse(_:text:context:)`` then requires
/// that nonce on every marker it finds. A role marker that appears in rendered
/// output but not in the original template can only have come from interpolated
/// input, so it will lack the nonce and be rejected. That closes the prompt
/// injection path where a template variable smuggles in `system:`.
///
/// Registered under the key `prompty`.
public struct PromptyChatParser: Parser {

  public init() {}

  // A role marker occupying an entire line, with an optional attribute block.
  private static let boundary = try! NSRegularExpression(
    pattern: #"^\s*#?\s*(system|user|assistant)(\[(\w+\s*=\s*"?[^"]*"?\s*,?\s*)+\])?\s*:\s*$"#,
    options: [.caseInsensitive]
  )

  // A single `key=value` pair inside an attribute block.
  private static let attribute = try! NSRegularExpression(
    pattern: #"(\w+)\s*=\s*"?([^",\]]*)"?"#
  )

  // MARK: - Parser

  /// Split a template or transcript into lines, tolerating Windows endings.
  ///
  /// The loader normalizes what it reads from disk, but a prompt built in
  /// memory — `Prompty.load` from a dictionary, or a template assembled by a
  /// host — never passes through it. Swift treats a CRLF pair as a single
  /// grapheme, so splitting such text on "\n" yields no split at all and every
  /// role marker is missed. `Lines` scans scalars, which never cluster.
  static func splitLines(_ text: String) -> [String] {
    Lines.splitLineFeeds(text)
  }

  public func preRender(template: String) throws -> Any? {
    let nonce = Self.generateNonce()
    let sanitized =
      Self.splitLines(template)
      .map { line -> String in
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard let match = Self.matchBoundary(trimmed) else { return line }
        return "\(match.role)[nonce=\"\(nonce)\"]:\n"
      }
      .joined(separator: "\n")

    return PreRenderResult(text: sanitized, context: ["nonce": nonce])
  }

  public func parse(agent: Prompty, rendered: String, context: [String: Any]?) async throws
    -> [Message]
  {
    try Self.parseChat(rendered, expectedNonce: context?["nonce"] as? String)
  }

  // MARK: - Parsing

  /// Parse without nonce validation.
  public static func parseChat(_ text: String) -> [Message] {
    (try? parseChat(text, expectedNonce: nil)) ?? []
  }

  /// Parse, validating nonces when `expectedNonce` is supplied.
  public static func parseChat(_ text: String, expectedNonce: String?) throws -> [Message] {
    var messages: [Message] = []
    var currentRole: Role = .system
    var contentLines: [String] = []
    var currentAttributes: [String: Any] = [:]
    var hasRoleMarker = false

    for line in Self.splitLines(text) {
      let trimmed = line.trimmingCharacters(in: .whitespaces)

      guard let match = matchBoundary(trimmed) else {
        // Accumulate the original line — indentation inside a turn matters.
        contentLines.append(line)
        continue
      }

      // A marker closes the turn before it. The `hasRoleMarker` guard keeps an
      // empty turn (`system:` immediately followed by `user:`) while suppressing
      // a phantom leading message when the text opens with a marker.
      if !contentLines.isEmpty || hasRoleMarker {
        messages.append(
          try buildMessage(
            role: currentRole,
            content: joinAndTrim(contentLines),
            attributes: currentAttributes,
            expectedNonce: hasRoleMarker ? expectedNonce : nil
          ))
        contentLines.removeAll()
        currentAttributes = [:]
      }

      currentRole = Role.parseOptional(match.role) ?? .system
      if let block = match.attributes {
        currentAttributes = parseAttributes(block)
      }
      hasRoleMarker = true
    }

    if !contentLines.isEmpty || hasRoleMarker {
      messages.append(
        try buildMessage(
          role: currentRole,
          content: joinAndTrim(contentLines),
          attributes: currentAttributes,
          expectedNonce: hasRoleMarker ? expectedNonce : nil
        ))
    }

    return messages
  }

  private static func buildMessage(
    role: Role,
    content: String,
    attributes: [String: Any],
    expectedNonce: String?
  ) throws -> Message {
    if let expected = expectedNonce {
      let actual = JSONSupport.stringify(attributes["nonce"])
      guard actual == expected else {
        throw InvokerError.parse(
          """
          Nonce mismatch — possible prompt injection detected (strict mode is \
          enabled). A template variable may be injecting role markers.
          """
        )
      }
    }

    // The nonce is a transport detail; everything else becomes metadata.
    var metadata = attributes
    metadata.removeValue(forKey: "nonce")

    return Message(role: role, parts: [.text(content)], metadata: metadata)
  }

  // MARK: - Helpers

  /// Match a role marker, returning the role and raw attribute block.
  static func matchBoundary(_ line: String) -> (role: String, attributes: String?)? {
    let range = NSRange(line.startIndex..<line.endIndex, in: line)
    guard let match = boundary.firstMatch(in: line, range: range) else { return nil }

    guard let roleRange = Range(match.range(at: 1), in: line) else { return nil }
    let role = String(line[roleRange]).lowercased()

    var attributes: String?
    if match.numberOfRanges > 2, let attrRange = Range(match.range(at: 2), in: line) {
      attributes = String(line[attrRange])
    }
    return (role, attributes)
  }

  /// Extract `key=value` pairs from an attribute block, coercing scalars.
  static func parseAttributes(_ raw: String) -> [String: Any] {
    var result: [String: Any] = [:]
    let range = NSRange(raw.startIndex..<raw.endIndex, in: raw)

    for match in attribute.matches(in: raw, range: range) {
      guard
        let keyRange = Range(match.range(at: 1), in: raw),
        let valueRange = Range(match.range(at: 2), in: raw)
      else { continue }

      let key = String(raw[keyRange])
      let value = String(raw[valueRange]).trimmingCharacters(in: .whitespaces)

      switch value.lowercased() {
      case "true": result[key] = true
      case "false": result[key] = false
      default:
        if let int = Int(value) {
          result[key] = int
        } else if let double = Double(value) {
          result[key] = double
        } else {
          result[key] = value
        }
      }
    }
    return result
  }

  /// Join lines, stripping leading and trailing newlines but preserving spaces.
  static func joinAndTrim(_ lines: [String]) -> String {
    var joined = Substring(lines.joined(separator: "\n"))
    while joined.first == "\n" { joined = joined.dropFirst() }
    while joined.last == "\n" { joined = joined.dropLast() }
    return String(joined)
  }

  /// 8 random bytes rendered as 16 hex characters.
  static func generateNonce() -> String {
    var hex = ""
    for _ in 0..<8 {
      hex += String(format: "%02x", UInt8.random(in: 0...255))
    }
    return hex
  }
}

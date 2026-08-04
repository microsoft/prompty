import Foundation

/// Line handling that is safe on Windows and faithful to the reference runtime.
///
/// Swift treats a CRLF pair as a single `Character`, so the obvious spellings
/// silently do the wrong thing: for `"a\r\nb"`, both
/// `components(separatedBy: "\n")` and `split(separator: "\n")` return the whole
/// string as one element. Rust splits at byte level and degrades gracefully, so
/// this is a Swift-specific hazard with no counterpart in the reference.
///
/// Everything here therefore walks `unicodeScalars` rather than `Character`s.
/// Normalizing first and splitting on characters afterwards is not enough: for
/// `"a\r\r\nb"` a single rewrite pass yields `"a\r\nb"`, whose CR and LF are now
/// adjacent and so collapse into one grapheme, and the split is missed again.
/// Scalars never cluster, so a scalar scanner has no such blind spot.
///
/// `Character.isNewline` is not the fix either — it also matches U+0085, U+2028
/// and U+2029, which are legal *inside* JSON strings. Splitting on those would
/// tear a JSON record in half and leave both pieces unparseable.
public enum Lines {

  /// Collapse CRLF pairs to LF.
  ///
  /// Only `\r\n` is rewritten. A lone CR is left alone, matching the Rust
  /// loader, which normalizes exactly this sequence and nothing else — treating
  /// a bare CR as a line ending would alter legitimate message content.
  public static func normalizeCRLF(_ text: String) -> String {
    // Scalar-level check: a CRLF pair is one Character, so `contains("\r")`
    // reports false for exactly the text this needs to catch.
    guard text.unicodeScalars.contains("\r") else { return text }

    var out = String.UnicodeScalarView()
    out.reserveCapacity(text.unicodeScalars.count)

    var scalars = text.unicodeScalars.makeIterator()
    var pending = scalars.next()
    while let scalar = pending {
      guard scalar == "\r" else {
        out.append(scalar)
        pending = scalars.next()
        continue
      }
      let next = scalars.next()
      if next == "\n" {
        out.append("\n")
        pending = scalars.next()
      } else {
        out.append("\r")
        pending = next
      }
    }
    return String(out)
  }

  /// Split on LF or CRLF, keeping empty lines. A lone CR stays as content.
  ///
  /// This is the template and transcript spelling: it mirrors the reference
  /// runtime, which normalizes `\r\n` and then splits on `\n` alone. Blank lines
  /// separate turns and paragraphs, so they must survive.
  public static func splitLineFeeds(_ text: String) -> [String] {
    scan(text, loneCarriageReturnTerminates: false, omittingEmpty: false)
  }

  /// Split on CR, LF, or CRLF, and on nothing else.
  ///
  /// Empty lines are dropped. Used for line-delimited formats — JSONL journals
  /// and server-sent events — where blank lines carry no record. Both formats
  /// allow a bare CR to end a line, and neither can carry one as data: an
  /// unescaped CR inside a JSON string is invalid JSON.
  public static func split(_ text: String) -> [String] {
    scan(text, loneCarriageReturnTerminates: true, omittingEmpty: true)
  }

  private static func scan(
    _ text: String,
    loneCarriageReturnTerminates: Bool,
    omittingEmpty: Bool
  ) -> [String] {
    var lines: [String] = []
    var current = String.UnicodeScalarView()

    func flush() {
      let line = String(current)
      current = String.UnicodeScalarView()
      if !omittingEmpty || !line.isEmpty { lines.append(line) }
    }

    var scalars = text.unicodeScalars.makeIterator()
    var pending = scalars.next()
    while let scalar = pending {
      switch scalar {
      case "\n":
        flush()
        pending = scalars.next()
      case "\r":
        // Look ahead one scalar: CRLF is a single terminator, never two.
        let next = scalars.next()
        if next == "\n" {
          flush()
          pending = scalars.next()
        } else if loneCarriageReturnTerminates {
          flush()
          pending = next
        } else {
          current.append("\r")
          pending = next
        }
      default:
        current.append(scalar)
        pending = scalars.next()
      }
    }

    // The trailing segment, which has no terminator after it. When empty lines
    // are kept this reproduces `components(separatedBy:)`, which yields a final
    // "" for text that ends in a terminator.
    flush()
    return lines
  }
}

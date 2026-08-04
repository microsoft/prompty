import Foundation
import PromptyModel
import XCTest

@testable import Prompty

/// Guards for Windows line endings.
///
/// Swift treats a CRLF pair as a single `Character`, so splitting text on a
/// literal `"\n"` does not split a CRLF document at all — it returns the whole
/// thing as one line. Rust splits at byte level and degrades gracefully, so
/// this is a Swift-specific hazard with no counterpart in the reference
/// implementation, and nothing in the LF-only spec vectors can catch it.
final class LineEndingTests: XCTestCase {

  /// A prompt assembled in memory with Windows line endings must parse.
  ///
  /// The loader normalizes files it reads, but a prompt built from a dictionary
  /// never passes through it, so every role marker was missed and parsing
  /// produced one lumped message.
  func testParserHandlesCarriageReturnLineEndings() async throws {
    let agent = try Prompty.load([
      "kind": "prompt",
      "name": "crlf",
      "instructions": "system:\r\nYou are helpful.\r\n\r\nuser:\r\nHello there.",
    ])

    let messages = try await Pipeline.prepare(agent)
    XCTAssertEqual(messages.map(\.role.rawValue), ["system", "user"])
    XCTAssertEqual(Self.text(messages[0].parts), "You are helpful.")
    XCTAssertEqual(Self.text(messages[1].parts), "Hello there.")
  }

  /// CRLF and LF forms of the same prompt must produce identical messages.
  func testCarriageReturnMatchesUnixParse() throws {
    let unix = "system:\nOne.\n\nuser:\nTwo.\n\nassistant:\nThree."
    let windows = unix.replacingOccurrences(of: "\n", with: "\r\n")

    let expected = PromptyChatParser.parseChat(unix)
    let actual = PromptyChatParser.parseChat(windows)

    XCTAssertEqual(expected.count, 3)
    XCTAssertEqual(actual.map(\.role.rawValue), expected.map(\.role.rawValue))
    XCTAssertEqual(actual.map { Self.text($0.parts) }, expected.map { Self.text($0.parts) })
  }

  /// Role markers must still be found after `preRender` rewrites the template.
  func testPreRenderRewritesCarriageReturnMarkers() throws {
    let parser = PromptyChatParser()
    let result = try parser.preRender(template: "system:\r\nOne.\r\n\r\nuser:\r\nTwo.")
    let prepared = try XCTUnwrap(result as? PreRenderResult)

    let nonce = try XCTUnwrap(prepared.context["nonce"] as? String)
    XCTAssertTrue(prepared.text.contains("system[nonce=\"\(nonce)\"]:"))
    XCTAssertTrue(prepared.text.contains("user[nonce=\"\(nonce)\"]:"))
  }

  /// A journal written with CRLF endings must replay.
  ///
  /// `readRecords` split on a literal `"\n"`, so a CRLF journal parsed as a
  /// single unparseable line and silently verified as empty.
  func testJournalReadsCarriageReturnRecords() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("prompty-crlf-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let path = directory.appendingPathComponent("journal.jsonl")
    let journal = #"{"type":"session_start"}"# + "\r\n" + #"{"type":"session_end"}"# + "\r\n"
    try journal.write(to: path, atomically: true, encoding: .utf8)

    let records = try JsonlEventJournalWriter.readRecords(path: path.path)
    XCTAssertEqual(records.count, 2)
    XCTAssertEqual(records.map { $0["type"] as? String }, ["session_start", "session_end"])
  }

  /// A journal record containing U+2028 must survive a round trip.
  ///
  /// `Character.isNewline` matches U+2028, U+2029 and U+0085, all of which are
  /// legal *inside* a JSON string. Splitting on them tore a record in half and
  /// left both pieces unparseable, so the record was silently discarded.
  func testJournalKeepsUnicodeLineSeparatorsInsideRecords() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("prompty-u2028-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let path = directory.appendingPathComponent("journal.jsonl")
    // U+2028 LINE SEPARATOR and U+0085 NEXT LINE, unescaped inside the value.
    let payload = "before\u{2028}after\u{0085}end"
    let journal = "{\"type\":\"note\",\"text\":\"\(payload)\"}\n{\"type\":\"session_end\"}\n"
    try journal.write(to: path, atomically: true, encoding: .utf8)

    let records = try JsonlEventJournalWriter.readRecords(path: path.path)
    XCTAssertEqual(records.count, 2)
    XCTAssertEqual(records[0]["text"] as? String, payload)
  }

  /// A lone CR is content, not a line ending.
  ///
  /// The reference loader normalizes `\r\n` and nothing else, so rewriting a
  /// bare CR would alter legitimate message text and diverge from every other
  /// runtime.
  func testLoneCarriageReturnIsPreservedAsContent() throws {
    let messages = PromptyChatParser.parseChat("user:\nbefore\rafter")

    XCTAssertEqual(messages.count, 1)
    XCTAssertEqual(Self.text(messages[0].parts), "before\rafter")
  }

  /// Splitting recognises the three real terminators and no others.
  func testLineSplitterRecognisesOnlyCarriageReturnAndLineFeed() {
    XCTAssertEqual(Lines.split("a\nb\r\nc\rd"), ["a", "b", "c", "d"])
    XCTAssertEqual(Lines.split("a\u{2028}b"), ["a\u{2028}b"])
    XCTAssertEqual(Lines.split("a\u{0085}b"), ["a\u{0085}b"])
    XCTAssertEqual(Lines.split("a\n\n\nb"), ["a", "b"])
  }

  /// A CR immediately before a CRLF must not hide the terminator.
  ///
  /// Normalizing and then splitting on characters is not enough: rewriting
  /// `"a\r\r\nb"` once yields `"a\r\nb"`, whose CR and LF are now adjacent and
  /// collapse into a single grapheme, so a character-level split misses it
  /// again. The scalar scanner has no such blind spot.
  func testAdjacentCarriageReturnsStillSplit() {
    // `split` treats a lone CR as a terminator, `splitLineFeeds` as content —
    // but neither may miss the CRLF that follows it. Before the scalar scanner
    // both returned the whole string as a single line.
    XCTAssertEqual(Lines.split("a\r\r\nb"), ["a", "b"])
    XCTAssertEqual(Lines.splitLineFeeds("a\r\r\nb"), ["a\r", "b"])

    let messages = PromptyChatParser.parseChat("system:\r\r\nOne.\r\r\n\r\r\nuser:\r\r\nTwo.")
    XCTAssertEqual(messages.map(\.role.rawValue), ["system", "user"])
  }

  /// Empty, terminator-only, and trailing-terminator inputs.
  ///
  /// `splitLineFeeds` stands in for `components(separatedBy:)` in the parser, so
  /// it has to agree with it on the trailing empty segment or turn content
  /// silently changes shape.
  func testLineSplitterEdgeCases() {
    XCTAssertEqual(Lines.split(""), [])
    XCTAssertEqual(Lines.split("\n\r\n\r"), [])
    XCTAssertEqual(Lines.split("a\n"), ["a"])

    XCTAssertEqual(Lines.splitLineFeeds(""), [""])
    XCTAssertEqual(Lines.splitLineFeeds("a\n"), ["a", ""])
    XCTAssertEqual(Lines.splitLineFeeds("a\r\n"), ["a", ""])
    // Agreement with the spelling it replaced, for LF-only text.
    for sample in ["", "a", "a\nb", "a\n", "\na", "a\n\nb"] {
      XCTAssertEqual(
        Lines.splitLineFeeds(sample), sample.components(separatedBy: "\n"),
        "diverged from components(separatedBy:) for \(sample.debugDescription)")
    }
  }

  /// A lone CR must not be promoted to a terminator by normalization.
  func testNormalizeRewritesOnlyCarriageReturnLineFeed() {
    XCTAssertEqual(Lines.normalizeCRLF("a\r\nb"), "a\nb")
    XCTAssertEqual(Lines.normalizeCRLF("a\rb"), "a\rb")
    XCTAssertEqual(Lines.normalizeCRLF("a\r\r\nb"), "a\r\nb")
    XCTAssertEqual(Lines.normalizeCRLF("a\n\rb"), "a\n\rb")
    XCTAssertEqual(Lines.normalizeCRLF("plain"), "plain")
  }

  private static func text(_ parts: [ContentPart]) -> String {
    parts.compactMap { part -> String? in
      if case .textPart(let text) = part { return text.value }
      return nil
    }.joined()
  }
}

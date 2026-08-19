import Foundation
import PromptyModel
import XCTest

/// Guards for Windows line endings.
///
/// Swift treats a CRLF pair as a single `Character`, so splitting text on a
/// literal `"\n"` does not split a CRLF document at all — it returns the whole
/// thing as one line. Rust splits at byte level and degrades gracefully, so
/// this is a Swift-specific hazard with no counterpart in the reference
/// implementation, and nothing in the LF-only spec vectors can catch it.
@testable import Prompty
@testable import PromptyOpenAI

final class LineEndingTests: XCTestCase {

  /// A prompt assembled in memory with Windows line endings must parse.
  ///
  /// The loader normalizes files it reads, but a prompt built from a dictionary
  /// never passes through it, so every role marker was missed and parsing
  /// produced one lumped message.
  func testParserHandlesCarriageReturnLineEndings() async throws {
    let agent = try Agent.load([
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

  // MARK: - Frontmatter

  /// `Frontmatter.split` must not depend on its caller having normalized first.
  ///
  /// It scanned with `firstIndex(of: "\n")`, which never matches in a CRLF
  /// document because the pair is one `Character`. The opening delimiter looked
  /// unterminated, so both the frontmatter and the body came back empty and a
  /// Windows-authored file was silently discarded with no error.
  func testFrontmatterSplitHandlesCarriageReturnDelimiters() throws {
    let raw = "---\r\nname: crlf\r\ndescription: windows\r\n---\r\nsystem:\r\nHello.\r\n"
    let (frontmatter, body) = try Frontmatter.split(raw)

    XCTAssertEqual(frontmatter["name"] as? String, "crlf")
    XCTAssertEqual(frontmatter["description"] as? String, "windows")
    XCTAssertEqual(body, "system:\nHello.\n")
  }

  /// The `+++` delimiter and an indented opener take the same scalar path.
  func testFrontmatterSplitHandlesCarriageReturnAlternateDelimiters() throws {
    let (frontmatter, body) = try Frontmatter.split("+++\r\nname: toml-style\r\n+++\r\nBody.")
    XCTAssertEqual(frontmatter["name"] as? String, "toml-style")
    XCTAssertEqual(body, "Body.")

    let indented = try Frontmatter.split("\r\n\r\n  ---\r\nname: indented\r\n  ---  \r\nBody.")
    XCTAssertEqual(indented.frontmatter["name"] as? String, "indented")
    XCTAssertEqual(indented.body, "Body.")
  }

  /// Blank-line skipping must use `isWhitespace`, not `CharacterSet.whitespaces`.
  ///
  /// `.whitespaces` is horizontal only: vertical tab, form feed, NEL, and the
  /// Unicode separators are excluded. Treating such a line as non-blank would
  /// make the opener unreachable and silently demote the file to body-only.
  func testFrontmatterSplitSkipsVerticalWhitespaceBeforeDelimiter() throws {
    for blank in ["\u{000B}", "\u{000C}", "\u{0085}", "\u{2028}", "\u{2029}"] {
      let (frontmatter, body) = try Frontmatter.split(
        "\(blank)\n---\nname: after-blank\n---\nBody.")
      XCTAssertEqual(
        frontmatter["name"] as? String, "after-blank",
        "U+\(String(format: "%04X", blank.unicodeScalars.first!.value)) should count as blank")
      XCTAssertEqual(body, "Body.")
    }
  }

  /// CRLF and LF forms of one document must split identically.
  func testFrontmatterSplitCarriageReturnMatchesUnix() throws {
    let unix = "---\nname: same\nmodel:\n  id: gpt-4o\n---\nsystem:\nOne.\n\nuser:\nTwo.\n"
    let windows = unix.replacingOccurrences(of: "\n", with: "\r\n")

    let expected = try Frontmatter.split(unix)
    let actual = try Frontmatter.split(windows)

    XCTAssertEqual(actual.frontmatter["name"] as? String, expected.frontmatter["name"] as? String)
    XCTAssertEqual(actual.body, expected.body)
  }

  /// A document with no frontmatter is still line-ending normalized.
  ///
  /// `split` owns the single normalization pass in the load path, so every
  /// return — including the body-only one — hands back LF.
  func testFrontmatterSplitWithoutDelimiterNormalizesCarriageReturns() throws {
    let (frontmatter, body) = try Frontmatter.split("system:\r\nNo frontmatter here.\r\n")

    XCTAssertTrue(frontmatter.isEmpty)
    XCTAssertEqual(body, "system:\nNo frontmatter here.\n")
  }

  /// `\r\r\n` must keep its lone CR: exactly one normalization pass runs.
  ///
  /// The scalar scanner reads the CR + LF pair as the terminator and leaves the
  /// preceding CR as content. A second pass over the already-normalized text
  /// would read the residual `\r\n` as another terminator and delete that CR —
  /// which is why `Loader` no longer normalizes before calling in.
  func testAdjacentCarriageReturnSurvivesSingleNormalizationPass() throws {
    let (_, body) = try Frontmatter.split("---\nname: cr\n---\nbefore\r\r\nafter")
    XCTAssertEqual(body, "before\r\nafter")

    let bodyOnly = try Frontmatter.split("before\r\r\nafter")
    XCTAssertEqual(bodyOnly.body, "before\r\nafter")
  }

  /// An unterminated CRLF document must still be reported, not silently emptied.
  func testFrontmatterSplitReportsUnclosedCarriageReturnDelimiter() {
    XCTAssertThrowsError(try Frontmatter.split("---\r\nname: unclosed\r\nstill: yaml\r\n")) {
      error in
      guard case LoadError.invalidFrontmatter = error else {
        return XCTFail("expected invalidFrontmatter, got \(error)")
      }
    }
  }

  // MARK: - Files on disk

  /// The end-to-end Windows case: a `.prompty` file whose bytes contain CRLF.
  ///
  /// Every other line-ending test builds its input in memory, so none of them
  /// exercises reading a file off disk and normalizing what came back.
  func testLoadsPromptyFileWrittenWithCarriageReturnBytes() async throws {
    let unix = """
      ---
      name: crlf-file
      model:
        id: gpt-4o
      ---
      system:
      You are helpful.

      user:
      Hello there.

      """
    let path = try Self.writeTemporaryPrompt(
      unix.replacingOccurrences(of: "\n", with: "\r\n"))
    defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }

    let agent = try Loader.load(path: path.path)
    XCTAssertEqual(agent.name, "crlf-file")
    XCTAssertEqual(agent.instructions, "system:\nYou are helpful.\n\nuser:\nHello there.")

    // The normalized instructions must still parse into distinct turns.
    let messages = try await Pipeline.prepare(agent)
    XCTAssertEqual(messages.map(\.role.rawValue), ["system", "user"])
    XCTAssertEqual(Self.text(messages[1].parts), "Hello there.")
  }

  /// End-to-end: a lone CR inside a `\r\r\n` sequence survives the load path.
  ///
  /// This is the composition regression — `Loader` must not normalize before
  /// `Frontmatter.split`, or the two passes together delete the CR.
  func testLoadedInstructionsKeepLoneCarriageReturn() throws {
    let raw = "---\r\nname: adjacent-cr\r\n---\r\nsystem:\r\nbefore\r\r\nafter\r\n"
    let path = try Self.writeTemporaryPrompt(raw)
    defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }

    let agent = try Loader.load(path: path.path)
    XCTAssertEqual(agent.instructions, "system:\nbefore\r\nafter")
  }

  /// A CRLF file and its LF twin must load to the same prompt.
  func testCarriageReturnFileMatchesUnixFile() throws {
    let unix = """
      ---
      name: twin
      description: line endings must not matter
      model:
        id: gpt-4o
      ---
      system:
      Identical.

      user:
      Content.

      """
    let unixPath = try Self.writeTemporaryPrompt(unix)
    let windowsPath = try Self.writeTemporaryPrompt(
      unix.replacingOccurrences(of: "\n", with: "\r\n"))
    defer {
      try? FileManager.default.removeItem(at: unixPath.deletingLastPathComponent())
      try? FileManager.default.removeItem(at: windowsPath.deletingLastPathComponent())
    }

    let expected = try Loader.load(path: unixPath.path)
    let actual = try Loader.load(path: windowsPath.path)

    XCTAssertEqual(actual.name, expected.name)
    XCTAssertEqual(actual.description, expected.description)
    XCTAssertEqual(actual.instructions, expected.instructions)
  }

  // MARK: - Server-sent events

  /// A `data:` line may still carry its CR when the transport splits on LF.
  ///
  /// `CharacterSet.whitespaces` is space and tab only, so a trailing CR survived
  /// trimming and `[DONE]` never compared equal.
  func testServerSentEventPayloadToleratesTrailingCarriageReturn() {
    XCTAssertEqual(SSE.payload(of: "data: [DONE]\r"), "[DONE]")
    XCTAssertEqual(SSE.payload(of: "data: {\"id\":\"a\"}\r"), "{\"id\":\"a\"}")
    XCTAssertEqual(SSE.payload(of: "data: [DONE]"), "[DONE]")
    XCTAssertNil(SSE.payload(of: "data:\r"))
    XCTAssertNil(SSE.payload(of: ": keep-alive\r"))
  }

  /// A CRLF-delimited SSE body must split into one record per event.
  func testServerSentEventStreamSplitsCarriageReturnDelimitedBody() {
    let body = "data: {\"n\":1}\r\n\r\ndata: {\"n\":2}\r\n\r\ndata: [DONE]\r\n"
    let payloads = Lines.split(body).compactMap(SSE.payload(of:))
    XCTAssertEqual(payloads, ["{\"n\":1}", "{\"n\":2}", "[DONE]"])
  }

  private static func writeTemporaryPrompt(_ contents: String) throws -> URL {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("prompty-line-endings-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let path = directory.appendingPathComponent("prompt.prompty")
    // Write bytes directly: a String write would be re-encoded by the platform.
    try Data(contents.utf8).write(to: path)
    return path
  }
}

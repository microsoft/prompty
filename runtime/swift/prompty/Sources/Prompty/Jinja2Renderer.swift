import Foundation
import PromptyModel

/// Renders the Jinja2 subset that Prompty templates use.
///
/// Supported: `{{ expr }}` with dotted paths and filters, `{% if %}` /
/// `{% else %}` / `{% endif %}`, `{% for x in xs %}` / `{% endfor %}`, and
/// `{# comments #}`.
///
/// Prompt templates are not HTML, so output is never escaped and whitespace is
/// preserved exactly. An undefined variable renders as an empty string.
public struct Jinja2Renderer: Renderer {

  public init() {}

  /// Render the agent's template.
  ///
  /// Inputs arrive already prepared: the pipeline has replaced rich-kind values
  /// with nonce placeholders. Preparing again here would mint a *second* nonce
  /// and leave the pipeline expanding a placeholder that no longer appears in
  /// the output, so this stage is deliberately a plain render.
  public func render(agent: Prompty, template: String, inputs: [String: Any]) async throws
    -> String
  {
    try render(template: template, inputs: inputs)
  }

  /// Render a raw template string.
  public func render(template: String, inputs: [String: Any]) throws -> String {
    var parser = TemplateParser(template)
    let nodes = try parser.parseNodes(until: nil).nodes
    var output = ""
    try emit(nodes, scope: inputs, into: &output)
    return output
  }

  // MARK: - Evaluation

  private func emit(_ nodes: [Node], scope: [String: Any], into output: inout String) throws {
    for node in nodes {
      switch node {
      case .text(let text):
        output += text

      case .expression(let source):
        output += JSONSupport.stringify(try evaluate(source, scope: scope))

      case .conditional(let condition, let body, let alternate):
        let value = try evaluate(condition, scope: scope)
        try emit(JSONSupport.isTruthy(value) ? body : alternate, scope: scope, into: &output)

      case .loop(let variable, let source, let body):
        let sequence = try evaluate(source, scope: scope)
        for element in iterate(sequence) {
          var inner = scope
          inner[variable] = element
          try emit(body, scope: inner, into: &output)
        }
      }
    }
  }

  private func iterate(_ value: Any?) -> [Any] {
    switch value {
    case let array as [Any]: return array
    case let dict as [String: Any]: return dict.keys.sorted().map { $0 }
    case let string as String: return string.map { String($0) }
    default: return []
    }
  }

  /// Evaluate a template expression.
  ///
  /// Delegates to ``ExpressionParser``, which understands comparisons, logical
  /// operators, arithmetic, membership, indexing and filters. Anything outside
  /// that grammar raises rather than silently resolving to `nil`.
  private func evaluate(_ source: String, scope: [String: Any]) throws -> Any? {
    try ExpressionParser.evaluate(source, scope: scope) { name, arguments, value in
      try applyFilter(name: name, arguments: arguments, to: value)
    }
  }

  private func applyFilter(name: String, arguments: [Any?], to value: Any?) throws -> Any? {
    switch name {
    case "upper":
      return JSONSupport.stringify(value).uppercased()
    case "lower":
      return JSONSupport.stringify(value).lowercased()
    case "trim":
      return JSONSupport.stringify(value).trimmingCharacters(in: .whitespacesAndNewlines)
    case "length", "count":
      switch value {
      case let array as [Any]: return array.count
      case let dict as [String: Any]: return dict.count
      case let string as String: return string.count
      case nil: return 0
      default: return JSONSupport.stringify(value).count
      }
    case "join":
      let separator = arguments.first.flatMap { $0 as? String } ?? ""
      let elements = iterate(value).map { JSONSupport.stringify($0) }
      return elements.joined(separator: separator)
    case "default", "d":
      if value == nil || value is NSNull || (value as? String)?.isEmpty == true {
        return arguments.first.flatMap { $0 } ?? ""
      }
      return value
    case "first":
      return iterate(value).first
    case "last":
      return iterate(value).last
    case "reverse":
      return iterate(value).reversed().map { $0 }
    case "capitalize":
      let string = JSONSupport.stringify(value)
      guard let head = string.first else { return string }
      return String(head).uppercased() + string.dropFirst().lowercased()
    case "string":
      return JSONSupport.stringify(value)
    case "int":
      if let int = value as? Int { return int }
      if let double = value as? Double { return Int(double) }
      return Int(JSONSupport.stringify(value)) ?? 0
    case "tojson", "to_json":
      return JSONSupport.toJSON(value)
    default:
      throw InvokerError.parse("unsupported template filter '\(name)'")
    }
  }

  private func parseFilter(_ spec: String) -> (name: String, arguments: [String]) {    guard let open = spec.firstIndex(of: "("), spec.hasSuffix(")") else {
      return (spec.trimmingCharacters(in: .whitespaces), [])
    }
    let name = String(spec[spec.startIndex..<open]).trimmingCharacters(in: .whitespaces)
    let inner = String(spec[spec.index(after: open)..<spec.index(before: spec.endIndex)])
    let arguments = splitTopLevel(inner, separator: ",")
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
    return (name, arguments)
  }

  /// Split on a separator, ignoring occurrences inside quotes or parentheses.
  private func splitTopLevel(_ text: String, separator: Character) -> [String] {
    var parts: [String] = []
    var current = ""
    var depth = 0
    var quote: Character?

    for character in text {
      if let active = quote {
        current.append(character)
        if character == active { quote = nil }
        continue
      }
      switch character {
      case "\"", "'":
        quote = character
        current.append(character)
      case "(", "[":
        depth += 1
        current.append(character)
      case ")", "]":
        depth -= 1
        current.append(character)
      case separator where depth == 0:
        parts.append(current)
        current = ""
      default:
        current.append(character)
      }
    }
    parts.append(current)
    return parts
  }
}

// MARK: - Template syntax tree

/// A parsed template node.
enum Node {
  case text(String)
  case expression(String)
  case conditional(condition: String, body: [Node], alternate: [Node])
  case loop(variable: String, source: String, body: [Node])
}

/// Recursive-descent parser for the supported Jinja2 subset.
struct TemplateParser {
  private let characters: [Character]
  private var index: Int = 0

  init(_ template: String) {
    self.characters = Array(template)
  }

  /// Parse until one of `terminators` is reached.
  ///
  /// Returns the parsed nodes and the terminating tag, which is `nil` at end of
  /// input.
  mutating func parseNodes(until terminators: Set<String>?) throws -> (
    nodes: [Node], terminator: String?
  ) {
    var nodes: [Node] = []
    var text = ""

    func flushText() {
      if !text.isEmpty {
        nodes.append(.text(text))
        text = ""
      }
    }

    while index < characters.count {
      guard characters[index] == "{", index + 1 < characters.count else {
        text.append(characters[index])
        index += 1
        continue
      }

      switch characters[index + 1] {
      case "{":
        flushText()
        nodes.append(.expression(try readDelimited(open: 2, close: "}}")))

      case "#":
        // Comments produce no output.
        _ = try readDelimited(open: 2, close: "#}")

      case "%":
        let tag = try readDelimited(open: 2, close: "%}")
        let keyword = tag.split(separator: " ", maxSplits: 1).first.map(String.init) ?? tag

        if let terminators, terminators.contains(keyword) {
          flushText()
          return (nodes, tag)
        }

        flushText()
        switch keyword {
        case "if":
          nodes.append(try parseConditional(tag))
        case "for":
          nodes.append(try parseLoop(tag))
        default:
          throw InvokerError.parse("unsupported template tag '{% \(tag) %}'")
        }

      default:
        text.append(characters[index])
        index += 1
      }
    }

    flushText()
    if let terminators, !terminators.isEmpty {
      throw InvokerError.parse(
        "unclosed template block — expected {% \(terminators.sorted().joined(separator: " / ")) %}")
    }
    return (nodes, nil)
  }

  private mutating func parseConditional(_ tag: String) throws -> Node {
    let condition = String(tag.dropFirst("if".count)).trimmingCharacters(in: .whitespaces)

    let branch = try parseNodes(until: ["else", "elif", "endif"])
    guard let terminator = branch.terminator else {
      throw InvokerError.parse("unclosed {% if %} block")
    }

    let keyword = terminator.split(separator: " ", maxSplits: 1).first.map(String.init) ?? terminator
    switch keyword {
    case "endif":
      return .conditional(condition: condition, body: branch.nodes, alternate: [])
    case "else":
      let alternate = try parseNodes(until: ["endif"])
      guard alternate.terminator != nil else {
        throw InvokerError.parse("unclosed {% if %} block")
      }
      return .conditional(condition: condition, body: branch.nodes, alternate: alternate.nodes)
    default:
      // `elif` is sugar for a nested conditional in the else branch.
      let nested = try parseConditional("if" + terminator.dropFirst("elif".count))
      return .conditional(condition: condition, body: branch.nodes, alternate: [nested])
    }
  }

  private mutating func parseLoop(_ tag: String) throws -> Node {
    let expression = String(tag.dropFirst("for".count)).trimmingCharacters(in: .whitespaces)
    let parts = expression.components(separatedBy: " in ")
    guard parts.count == 2 else {
      throw InvokerError.parse("malformed loop tag '{% \(tag) %}'")
    }

    let body = try parseNodes(until: ["endfor"])
    guard body.terminator != nil else {
      throw InvokerError.parse("unclosed {% for %} block")
    }

    return .loop(
      variable: parts[0].trimmingCharacters(in: .whitespaces),
      source: parts[1].trimmingCharacters(in: .whitespaces),
      body: body.nodes
    )
  }

  /// Consume `open` characters, then everything up to `close`.
  private mutating func readDelimited(open: Int, close: String) throws -> String {
    index += open
    let closing = Array(close)
    let start = index

    while index < characters.count {
      if characters[index] == closing[0], index + closing.count <= characters.count,
        Array(characters[index..<index + closing.count]) == closing
      {
        let content = String(characters[start..<index])
        index += closing.count
        return content.trimmingCharacters(in: .whitespaces)
      }
      index += 1
    }
    throw InvokerError.parse("unterminated template delimiter — expected '\(close)'")
  }
}

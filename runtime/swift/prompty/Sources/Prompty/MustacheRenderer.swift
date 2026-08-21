import Foundation

/// Renders Mustache templates.
///
/// Supported: `{{name}}` interpolation with dotted paths, `{{#section}}`
/// sections (truthy value, or iteration when the value is a list), `{{^section}}`
/// inverted sections, `{{.}}` implicit iteration context, and `{{! comment }}`.
///
/// As with Jinja2, output is never HTML-escaped — `{{{triple}}}` and `{{&raw}}`
/// are accepted but behave identically to `{{double}}`.
import PromptyModel

// MARK: - Template syntax tree

public struct MustacheRenderer: Renderer {

  public init() {}

  /// Render the agent's template.
  ///
  /// Inputs arrive already prepared by the pipeline; see the note on
  /// ``Jinja2Renderer/render(agent:template:inputs:)``.
  public func render(agent: Agent, template: String, inputs: [String: Any]) async throws
    -> String
  {
    try render(template: template, inputs: inputs)
  }

  /// Render a raw template string.
  public func render(template: String, inputs: [String: Any]) throws -> String {
    var scanner = Scanner(template)
    let nodes = try scanner.parse(closing: nil).nodes
    var output = ""
    emit(nodes, stack: [inputs], into: &output)
    return output
  }

  /// Render the template into a provenance-tagged segment tree.
  ///
  /// Mustache is not the Prompty Jinja Subset and carries no interpolation provenance, so the
  /// flat render is returned as a single `literal` span. Concatenating the span text still
  /// reproduces ``render(agent:template:inputs:)``, satisfying the render/renderSegments
  /// consistency contract.
  public func renderSegments(agent: Agent, template: String, inputs: [String: Any]) async throws
    -> [RenderSegment]
  {
    let rendered = try render(template: template, inputs: inputs)
    return [RenderSegment(kind: try RenderSegmentKind.parse("literal"), text: rendered)]
  }

  // MARK: - Evaluation

  private func emit(_ nodes: [MustacheNode], stack: [Any], into output: inout String) {
    for node in nodes {
      switch node {
      case .text(let text):
        output += text

      case .variable(let name):
        output += JSONSupport.stringify(resolve(name, stack: stack))

      case .section(let name, let body):
        let value = resolve(name, stack: stack)
        if let array = value as? [Any] {
          for element in array {
            emit(body, stack: stack + [element], into: &output)
          }
        } else if JSONSupport.isTruthy(value) {
          emit(body, stack: stack + [value as Any], into: &output)
        }

      case .inverted(let name, let body):
        let value = resolve(name, stack: stack)
        let isEmpty = (value as? [Any])?.isEmpty ?? !JSONSupport.isTruthy(value)
        if isEmpty {
          emit(body, stack: stack, into: &output)
        }
      }
    }
  }

  /// Look up a name against the context stack, innermost frame first.
  private func resolve(_ name: String, stack: [Any]) -> Any? {
    // `.` refers to the current context itself.
    if name == "." { return stack.last }

    for frame in stack.reversed() {
      guard let dictionary = frame as? [String: Any] else { continue }
      if let value = JSONSupport.lookup(name, in: dictionary) { return value }
    }
    return nil
  }
}
enum MustacheNode {
  case text(String)
  case variable(String)
  case section(name: String, body: [MustacheNode])
  case inverted(name: String, body: [MustacheNode])
}
private struct Scanner {
  private let characters: [Character]
  private var index = 0

  init(_ template: String) {
    self.characters = Array(template)
  }

  /// Parse until `{{/closing}}` is reached, or end of input when `closing` is nil.
  mutating func parse(closing: String?) throws -> (nodes: [MustacheNode], closed: Bool) {
    var nodes: [MustacheNode] = []
    var text = ""

    func flushText() {
      if !text.isEmpty {
        nodes.append(.text(text))
        text = ""
      }
    }

    while index < characters.count {
      guard characters[index] == "{", index + 1 < characters.count, characters[index + 1] == "{"
      else {
        text.append(characters[index])
        index += 1
        continue
      }

      // `{{{raw}}}` uses a three-character close.
      let isTriple = index + 2 < characters.count && characters[index + 2] == "{"
      let tag = try readTag(triple: isTriple)

      guard let sigil = tag.first else {
        flushText()
        nodes.append(.variable(""))
        continue
      }

      let name = String(tag.dropFirst()).trimmingCharacters(in: .whitespaces)

      switch sigil {
      case "!":
        // Comment — no output.
        continue

      case "#", "^":
        flushText()
        let inner = try parse(closing: name)
        guard inner.closed else {
          throw InvokerError.parse("unclosed mustache section '{{#\(name)}}'")
        }
        nodes.append(
          sigil == "#"
            ? .section(name: name, body: inner.nodes)
            : .inverted(name: name, body: inner.nodes))

      case "/":
        flushText()
        guard let closing, closing == name else {
          throw InvokerError.parse("unexpected mustache close tag '{{/\(name)}}'")
        }
        return (nodes, true)

      case "&":
        flushText()
        nodes.append(.variable(name))

      default:
        flushText()
        nodes.append(.variable(tag.trimmingCharacters(in: .whitespaces)))
      }
    }

    flushText()
    if closing != nil {
      throw InvokerError.parse("unclosed mustache section '{{#\(closing!)}}'")
    }
    return (nodes, false)
  }

  private mutating func readTag(triple: Bool) throws -> String {
    let close = Array(triple ? "}}}" : "}}")
    index += triple ? 3 : 2
    let start = index

    while index < characters.count {
      if characters[index] == "}", index + close.count <= characters.count,
        Array(characters[index..<index + close.count]) == close
      {
        let content = String(characters[start..<index])
        index += close.count
        return content
      }
      index += 1
    }
    throw InvokerError.parse("unterminated mustache tag")
  }
}

import Foundation

public enum JinjaError: Error, Equatable, CustomStringConvertible {
  case syntax(String)
  case evaluation(String)
  case strictViolation(String)

  public var description: String {
    switch self {
    case .syntax(let message): return message
    case .evaluation(let message): return message
    case .strictViolation(let message): return message
    }
  }
}

public struct Segment: Equatable {
  public let kind: String
  public let text: String
  public let source: String?
  public let strict: Bool

  public init(kind: String, text: String, source: String? = nil, strict: Bool = false) {
    self.kind = kind
    self.text = text
    self.source = source
    self.strict = strict
  }
}

enum JinjaTokenType { case text, expr, stmt, comment }

struct JinjaToken {
  let type: JinjaTokenType
  var value: String
  let trimLeft: Bool
  let trimRight: Bool
}

enum JinjaTokenizer {
  static func tokenize(_ template: String) throws -> [JinjaToken] {
    let chars = Array(template)
    var raw: [JinjaToken] = []
    var index = 0
    var textStart = 0

    func two(at i: Int) -> String? {
      guard i + 1 < chars.count else { return nil }
      return String([chars[i], chars[i + 1]])
    }

    while index < chars.count {
      guard let opener = two(at: index), opener == "{{" || opener == "{%" || opener == "{#" else {
        index += 1
        continue
      }

      if index > textStart {
        raw.append(JinjaToken(type: .text, value: String(chars[textStart..<index]), trimLeft: false, trimRight: false))
      }

      let close = opener == "{{" ? "}}" : (opener == "{%" ? "%}" : "#}")
      let tokenType: JinjaTokenType = opener == "{{" ? .expr : (opener == "{%" ? .stmt : .comment)
      var search = index + 2
      var closeIndex: Int?
      while search + 1 < chars.count {
        if String([chars[search], chars[search + 1]]) == close {
          closeIndex = search
          break
        }
        search += 1
      }
      guard let closeIndex else { throw JinjaError.syntax("Unclosed '\(opener)' tag at offset \(index)") }

      var inner = String(chars[(index + 2)..<closeIndex])
      let trimLeft = inner.hasPrefix("-")
      let trimRight = inner.hasSuffix("-")
      if trimLeft { inner.removeFirst() }
      if trimRight { inner.removeLast() }

      if tokenType == .comment {
        raw.append(JinjaToken(type: .comment, value: "", trimLeft: trimLeft, trimRight: trimRight))
      } else {
        raw.append(JinjaToken(type: tokenType, value: trimASCIIWhitespace(inner), trimLeft: trimLeft, trimRight: trimRight))
      }

      index = closeIndex + 2
      textStart = index
    }

    if textStart < chars.count {
      raw.append(JinjaToken(type: .text, value: String(chars[textStart..<chars.count]), trimLeft: false, trimRight: false))
    }
    applyTrims(&raw)
    return raw.filter { $0.type != .comment }
  }

  private static func applyTrims(_ tokens: inout [JinjaToken]) {
    for idx in tokens.indices where tokens[idx].type != .text {
      if tokens[idx].trimLeft, idx > tokens.startIndex, tokens[idx - 1].type == .text {
        tokens[idx - 1].value = trimASCIIWhitespace(tokens[idx - 1].value, leading: false, trailing: true)
      }
      let next = idx + 1
      if tokens[idx].trimRight, next < tokens.endIndex, tokens[next].type == .text {
        tokens[next].value = trimASCIIWhitespace(tokens[next].value, leading: true, trailing: false)
      }
    }
  }
}

private func trimASCIIWhitespace(_ text: String, leading: Bool = true, trailing: Bool = true) -> String {
  var start = text.startIndex
  var end = text.endIndex
  if leading {
    while start < end, isASCIIWhitespace(text[start]) {
      start = text.index(after: start)
    }
  }
  if trailing {
    while end > start {
      let before = text.index(before: end)
      guard isASCIIWhitespace(text[before]) else { break }
      end = before
    }
  }
  return String(text[start..<end])
}

private func isASCIIWhitespace(_ character: Character) -> Bool {
  character == " " || character == "\t" || character == "\r" || character == "\n"
}

indirect enum JinjaExpr {
  case lit(Any?)
  case variable(root: String, path: [JinjaPathSegment])
  case filter(name: String, input: JinjaExpr, args: [JinjaExpr])
  case unary(op: String, operand: JinjaExpr)
  case binary(op: String, left: JinjaExpr, right: JinjaExpr)
}

indirect enum JinjaPathSegment {
  case attr(String)
  case index(JinjaExpr)
}

struct JinjaBranch {
  let test: JinjaExpr
  let body: [JinjaNode]
}

indirect enum JinjaNode {
  case text(String)
  case interp(JinjaExpr)
  case `if`(branches: [JinjaBranch], elseBody: [JinjaNode]?)
  case `for`(loopVar: String, seq: JinjaExpr, body: [JinjaNode])
}

enum ExprToken: Equatable {
  case string(String)
  case number(Any)
  case op(String)
  case keyword(String)
  case name(String)

  static func == (lhs: ExprToken, rhs: ExprToken) -> Bool {
    switch (lhs, rhs) {
    case (.string(let a), .string(let b)): return a == b
    case (.op(let a), .op(let b)): return a == b
    case (.keyword(let a), .keyword(let b)): return a == b
    case (.name(let a), .name(let b)): return a == b
    case (.number, .number): return false
    default: return false
    }
  }
}

enum JinjaParser {
  static func parseTemplate(_ template: String) throws -> [JinjaNode] {
    var parser = TemplateParser(tokens: try JinjaTokenizer.tokenize(template))
    return try parser.parse()
  }

  fileprivate static func parseExpression(_ source: String) throws -> JinjaExpr {
    var parser = ExprParser(tokens: try lexExpression(source), source: source)
    return try parser.parse()
  }

  private static func lexExpression(_ source: String) throws -> [ExprToken] {
    let chars = Array(source)
    var tokens: [ExprToken] = []
    var i = 0
    while i < chars.count {
      let c = chars[i]
      if c == " " || c == "\t" || c == "\r" || c == "\n" { i += 1; continue }
      if c == "\"" || c == "'" {
        let quote = c
        i += 1
        var buffer = ""
        while i < chars.count, chars[i] != quote {
          if chars[i] == "\\", i + 1 < chars.count {
            buffer.append(chars[i + 1])
            i += 2
          } else {
            buffer.append(chars[i])
            i += 1
          }
        }
        guard i < chars.count else { throw JinjaError.syntax("Unterminated string in expression: \(source)") }
        i += 1
        tokens.append(.string(buffer))
        continue
      }
      if c.isNumber || (c == "-" && i + 1 < chars.count && chars[i + 1].isNumber) {
        let start = i
        i += 1
        while i < chars.count, chars[i].isNumber || chars[i] == "." { i += 1 }
        let number = String(chars[start..<i])
        if number.contains(".") {
          guard let value = Double(number) else { throw JinjaError.syntax("Invalid number in expression: \(source)") }
          tokens.append(.number(value))
        } else {
          guard let value = Int64(number) else { throw JinjaError.syntax("Invalid number in expression: \(source)") }
          tokens.append(.number(value))
        }
        continue
      }
      if c.isLetter || c == "_" {
        let start = i
        i += 1
        while i < chars.count, chars[i].isLetter || chars[i].isNumber || chars[i] == "_" { i += 1 }
        let word = String(chars[start..<i])
        if ["and", "or", "not", "in", "true", "false", "null"].contains(word) {
          tokens.append(.keyword(word))
        } else {
          tokens.append(.name(word))
        }
        continue
      }
      if i + 1 < chars.count {
        let two = String([chars[i], chars[i + 1]])
        if ["==", "!=", "<=", ">="].contains(two) {
          tokens.append(.op(two))
          i += 2
          continue
        }
      }
      if "()[].,|<>".contains(c) {
        tokens.append(.op(String(c)))
        i += 1
        continue
      }
      throw JinjaError.syntax("Unexpected character '\(c)' in expression: \(source)")
    }
    return tokens
  }
}

struct ExprParser {
  let tokens: [ExprToken]
  let source: String
  var position = 0

  mutating func parse() throws -> JinjaExpr {
    let expr = try parseOr()
    guard position == tokens.count else { throw JinjaError.syntax("Trailing tokens in expression: \(source)") }
    return expr
  }

  private func peek() -> ExprToken? { position < tokens.count ? tokens[position] : nil }
  @discardableResult private mutating func next() -> ExprToken { defer { position += 1 }; return tokens[position] }
  private func isToken(_ token: ExprToken) -> Bool { peek() == token }

  private mutating func parseOr() throws -> JinjaExpr {
    var left = try parseAnd()
    while isToken(.keyword("or")) {
      next()
      left = .binary(op: "or", left: left, right: try parseAnd())
    }
    return left
  }

  private mutating func parseAnd() throws -> JinjaExpr {
    var left = try parseNot()
    while isToken(.keyword("and")) {
      next()
      left = .binary(op: "and", left: left, right: try parseNot())
    }
    return left
  }

  private mutating func parseNot() throws -> JinjaExpr {
    if isToken(.keyword("not")) {
      next()
      return .unary(op: "not", operand: try parseNot())
    }
    return try parseComparison()
  }

  private mutating func parseComparison() throws -> JinjaExpr {
    let left = try parseFilter()
    if case .op(let op)? = peek(), ["==", "!=", "<", ">", "<=", ">="].contains(op) {
      next()
      return .binary(op: op, left: left, right: try parseFilter())
    }
    if isToken(.keyword("in")) {
      next()
      return .binary(op: "in", left: left, right: try parseFilter())
    }
    return left
  }

  private mutating func parseFilter() throws -> JinjaExpr {
    var expr = try parsePrimary()
    while isToken(.op("|")) {
      next()
      guard case .name(let name)? = peek() else { throw JinjaError.syntax("Expected filter name in: \(source)") }
      next()
      var args: [JinjaExpr] = []
      if isToken(.op("(")) {
        next()
        if !isToken(.op(")")) {
          args.append(try parseOr())
          while isToken(.op(",")) {
            next()
            args.append(try parseOr())
          }
        }
        guard isToken(.op(")")) else { throw JinjaError.syntax("Unclosed filter args in: \(source)") }
        next()
      }
      expr = .filter(name: name, input: expr, args: args)
    }
    return expr
  }

  private mutating func parsePrimary() throws -> JinjaExpr {
    guard let token = peek() else { throw JinjaError.syntax("Unexpected end of expression: \(source)") }
    switch token {
    case .op("("):
      next()
      let expr = try parseOr()
      guard isToken(.op(")")) else { throw JinjaError.syntax("Unclosed parenthesis in: \(source)") }
      next()
      return expr
    case .string(let value): next(); return .lit(value)
    case .number(let value): next(); return .lit(value)
    case .keyword("true"): next(); return .lit(true)
    case .keyword("false"): next(); return .lit(false)
    case .keyword("null"): next(); return .lit(nil)
    case .name:
      return try parseAccessor()
    default:
      throw JinjaError.syntax("Unexpected token '\(token)' in expression: \(source)")
    }
  }

  private mutating func parseAccessor() throws -> JinjaExpr {
    guard case .name(let root) = next() else { throw JinjaError.syntax("Expected name in expression: \(source)") }
    var path: [JinjaPathSegment] = []
    while true {
      if isToken(.op(".")) {
        next()
        switch peek() {
        case .name(let name), .keyword(let name): next(); path.append(.attr(name))
        default: throw JinjaError.syntax("Expected attribute name in: \(source)")
        }
      } else if isToken(.op("[")) {
        next()
        let indexExpr = try parseOr()
        guard isToken(.op("]")) else { throw JinjaError.syntax("Unclosed index in: \(source)") }
        next()
        path.append(.index(indexExpr))
      } else {
        break
      }
    }
    return .variable(root: root, path: path)
  }
}

struct TemplateParser {
  let tokens: [JinjaToken]
  var position = 0

  mutating func parse() throws -> [JinjaNode] { try parseNodes(terminators: []) }
  private func peek() -> JinjaToken? { position < tokens.count ? tokens[position] : nil }

  private mutating func parseNodes(terminators: Set<String>) throws -> [JinjaNode] {
    var nodes: [JinjaNode] = []
    while position < tokens.count {
      let token = tokens[position]
      if token.type == .stmt {
        let (head, _) = stmtHead(token.value)
        if terminators.contains(head) { return nodes }
        if head == "if" { nodes.append(try parseIf()); continue }
        if head == "for" { nodes.append(try parseFor()); continue }
        throw JinjaError.syntax("Unexpected statement '\(token.value)'")
      }
      if token.type == .text {
        position += 1
        nodes.append(.text(token.value))
        continue
      }
      if token.type == .expr {
        position += 1
        nodes.append(.interp(try JinjaParser.parseExpression(token.value)))
        continue
      }
      throw JinjaError.syntax("Unexpected token type \(token.type)")
    }
    if !terminators.isEmpty {
      throw JinjaError.syntax("Unclosed block; expected one of \(Array(terminators).joined(separator: ", "))")
    }
    return nodes
  }

  private mutating func parseIf() throws -> JinjaNode {
    var branches: [JinjaBranch] = []
    let (_, rest) = stmtHead(tokens[position].value)
    position += 1
    branches.append(JinjaBranch(test: try JinjaParser.parseExpression(rest), body: try parseNodes(terminators: ["elif", "else", "endif"])))
    var elseBody: [JinjaNode]?
    while true {
      guard let token = peek() else { throw JinjaError.syntax("Unclosed 'if' block") }
      let (head, rest) = stmtHead(token.value)
      if head == "elif" {
        position += 1
        branches.append(JinjaBranch(test: try JinjaParser.parseExpression(rest), body: try parseNodes(terminators: ["elif", "else", "endif"])))
      } else if head == "else" {
        position += 1
        elseBody = try parseNodes(terminators: ["endif"])
      } else if head == "endif" {
        position += 1
        break
      } else {
        throw JinjaError.syntax("Unexpected '\(token.value)' in if block")
      }
    }
    return .if(branches: branches, elseBody: elseBody)
  }

  private mutating func parseFor() throws -> JinjaNode {
    let (_, rest) = stmtHead(tokens[position].value)
    position += 1
    let parts = rest.split(maxSplits: 2, whereSeparator: { $0.isWhitespace }).map(String.init)
    guard parts.count == 3, parts[1] == "in" else { throw JinjaError.syntax("Malformed for statement: 'for \(rest)'") }
    let body = try parseNodes(terminators: ["endfor"])
    guard let end = peek(), stmtHead(end.value).head == "endfor" else { throw JinjaError.syntax("Unclosed 'for' block") }
    position += 1
    return .for(loopVar: parts[0], seq: try JinjaParser.parseExpression(parts[2]), body: body)
  }

  private func stmtHead(_ value: String) -> (head: String, rest: String) {
    let parts = value.split(maxSplits: 1, whereSeparator: { $0.isWhitespace }).map(String.init)
    return (parts.first ?? "", parts.count > 1 ? parts[1] : "")
  }
}

final class JinjaUndefined {}
let jinjaUndefined = JinjaUndefined()

public func renderSegments(template: String, inputs: [String: Any] = [:], strictProps: [String] = []) throws -> [Segment] {
  let nodes = try JinjaParser.parseTemplate(template)
  var output: [Segment] = []
  let frame = JinjaFrame(scope: inputs, strictProps: Set(strictProps))
  try renderNodes(nodes, frame: frame, output: &output)
  return output
}

public func render(template: String, inputs: [String: Any] = [:], strictProps: [String] = []) throws -> String {
  try renderSegments(template: template, inputs: inputs, strictProps: strictProps).map(\.text).joined()
}

struct JinjaFrame {
  let scope: [String: Any]
  let strictProps: Set<String>
}

private func renderNodes(_ nodes: [JinjaNode], frame: JinjaFrame, output: inout [Segment]) throws {
  for node in nodes {
    switch node {
    case .text(let text):
      if !text.isEmpty { appendSegment(Segment(kind: "literal", text: text), to: &output) }
    case .interp(let expr):
      let value = try eval(expr, scope: frame.scope)
      let text = stringify(value)
      let source = interpSource(expr)
      let isStrict = source.map { frame.strictProps.contains($0) } ?? false
      if isStrict && containsRoleBoundary(text) {
        throw JinjaError.strictViolation("strict input '\(source ?? "")' produced a forged role boundary: \(text)")
      }
      appendSegment(Segment(kind: "interp", text: text, source: source, strict: isStrict), to: &output)
    case .if(let branches, let elseBody):
      var emitted = false
      for branch in branches where try truthy(eval(branch.test, scope: frame.scope)) {
        try renderNodes(branch.body, frame: frame, output: &output)
        emitted = true
        break
      }

      if !emitted, let elseBody { try renderNodes(elseBody, frame: frame, output: &output) }
    case .for(let loopVar, let seq, let body):
      let items = try iterSeq(eval(seq, scope: frame.scope))
      for (idx, item) in items.enumerated() {
        var child = frame.scope
        child[loopVar] = item
        child["loop"] = [
          "index": idx + 1,
          "index0": idx,
          "first": idx == 0,
          "last": idx == items.count - 1,
          "length": items.count,
        ]
        try renderNodes(body, frame: JinjaFrame(scope: child, strictProps: frame.strictProps), output: &output)
      }
    }
  }
}

private func appendSegment(_ segment: Segment, to output: inout [Segment]) {
  guard segment.kind == "literal", !output.isEmpty, output[output.count - 1].kind == "literal" else {
    output.append(segment)
    return
  }
  let previous = output.removeLast()
  output.append(Segment(kind: "literal", text: previous.text + segment.text))
}

private func containsRoleBoundary(_ text: String) -> Bool {
  let pattern = #"^\s*(system|user|assistant|developer)\s*:"#
  guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .anchorsMatchLines]) else {
    return false
  }
  let range = NSRange(text.startIndex..<text.endIndex, in: text)
  return regex.firstMatch(in: text, range: range) != nil
}

private func interpSource(_ expr: JinjaExpr) -> String? {
  if case .variable(let root, _) = expr { return root }
  return nil
}

private func eval(_ expr: JinjaExpr, scope: [String: Any]) throws -> Any? {
  switch expr {
  case .lit(let value): return value
  case .variable(let root, let path):
    var value: Any? = scope[root] ?? jinjaUndefined
    for segment in path { value = try access(value, segment: segment, scope: scope) }
    return value
  case .filter(let name, let input, let args):
    return try applyFilter(name: name, value: eval(input, scope: scope), args: args.map { try eval($0, scope: scope) })
  case .unary(let op, let operand):
    guard op == "not" else { throw JinjaError.evaluation("Unknown unary operator: \(op)") }
    return try !truthy(eval(operand, scope: scope))
  case .binary(let op, let left, let right):
    return try evalBinary(op: op, left: left, right: right, scope: scope)
  }
}

private func access(_ value: Any?, segment: JinjaPathSegment, scope: [String: Any]) throws -> Any? {
  if value == nil || value is NSNull || value is JinjaUndefined { return jinjaUndefined }
  switch segment {
  case .attr(let name):
    if let dict = value as? [String: Any] { return dict[name] ?? jinjaUndefined }
    return jinjaUndefined
  case .index(let indexExpr):
    let index = try eval(indexExpr, scope: scope)
    if let dict = value as? [String: Any], let key = index as? String { return dict[key] ?? jinjaUndefined }
    if let array = value as? [Any], var i = toIndex(index) {
      if i < 0 { i += array.count }
      return i >= 0 && i < array.count ? array[i] : jinjaUndefined
    }
    if let string = value as? String, var i = toIndex(index) {
      let chars = Array(string)
      if i < 0 { i += chars.count }
      return i >= 0 && i < chars.count ? String(chars[i]) : jinjaUndefined
    }
    return jinjaUndefined
  }
}

private func evalBinary(op: String, left: JinjaExpr, right: JinjaExpr, scope: [String: Any]) throws -> Any? {
  if op == "and" {
    let leftValue = try eval(left, scope: scope)
    return try truthy(leftValue) ? eval(right, scope: scope) : leftValue
  }
  if op == "or" {
    let leftValue = try eval(left, scope: scope)
    return try truthy(leftValue) ? leftValue : eval(right, scope: scope)
  }
  let l = try eval(left, scope: scope)
  let r = try eval(right, scope: scope)
  if op == "in" { return valueIn(l, r) }
  let lc = l is JinjaUndefined ? nil : l
  let rc = r is JinjaUndefined ? nil : r
  switch op {
  case "==": return valueEquals(lc, rc)
  case "!=": return !valueEquals(lc, rc)
  case "<", ">", "<=", ">=":
    if let a = number(lc), let b = number(rc) {
      switch op { case "<": return a < b; case ">": return a > b; case "<=": return a <= b; default: return a >= b }
    }
    if let a = lc as? String, let b = rc as? String {
      switch op { case "<": return a < b; case ">": return a > b; case "<=": return a <= b; default: return a >= b }
    }
    return false
  default:
    throw JinjaError.evaluation("Unknown binary operator: \(op)")
  }
}

private func applyFilter(name: String, value: Any?, args: [Any?]) throws -> Any? {
  switch name {
  case "upper": return stringify(value).uppercased()
  case "lower": return stringify(value).lowercased()
  case "trim": return trimASCIIWhitespace(stringify(value))
  case "join":
    let sep = args.first.map(stringify) ?? ""
    let seq = value as? [Any] ?? []
    return seq.map(stringify).joined(separator: sep)
  case "length":
    if value == nil || value is NSNull || value is JinjaUndefined { return 0 }
    if let string = value as? String { return string.count }
    if let array = value as? [Any] { return array.count }
    if let dict = value as? [String: Any] { return dict.count }
    return 0
  case "default":
    return (value == nil || value is NSNull || value is JinjaUndefined) ? (args.first ?? "") : value
  case "replace":
    guard args.count >= 2 else { throw JinjaError.evaluation("replace filter requires (old, new) arguments") }
    let old = stringify(args[0])
    return old.isEmpty ? stringify(value) : stringify(value).replacingOccurrences(of: old, with: stringify(args[1]))
  default:
    throw JinjaError.evaluation("Unknown filter: \(name)")
  }
}

private func iterSeq(_ value: Any?) throws -> [Any] {
  if value == nil || value is NSNull || value is JinjaUndefined { return [] }
  if let dict = value as? [String: Any] { return dict.keys.map { $0 } }
  if let array = value as? [Any] { return array }
  if let string = value as? String { return string.map { String($0) } }
  return []
}

private func truthy(_ value: Any?) throws -> Bool {
  if value == nil || value is NSNull || value is JinjaUndefined { return false }
  if let bool = value as? Bool { return bool }
  if let string = value as? String { return !string.isEmpty }
  if let array = value as? [Any] { return !array.isEmpty }
  if let dict = value as? [String: Any] { return !dict.isEmpty }
  if let n = number(value) { return n != 0 }
  return true
}

private func stringify(_ value: Any?) -> String {
  if value == nil || value is NSNull || value is JinjaUndefined { return "" }
  if let bool = value as? Bool { return bool ? "true" : "false" }
  if let int = integer(value) { return String(int) }
  if let double = number(value) {
    if double.isFinite && floor(double) == double && abs(double) < 9.2e18 { return String(Int64(double)) }
    return String(format: "%.15g", double)
  }
  if let string = value as? String { return string }
  if let array = value as? [Any] { return array.map(stringify).joined() }
  return String(describing: value!)
}

private func valueIn(_ left: Any?, _ right: Any?) -> Bool {
  if let dict = right as? [String: Any], let key = left as? String { return dict.keys.contains(key) }
  if let array = right as? [Any] { return array.contains { valueEquals($0, left) } }
  if let string = right as? String, let sub = left as? String { return string.contains(sub) }
  return false
}

private func valueEquals(_ a: Any?, _ b: Any?) -> Bool {
  if (a == nil || a is NSNull || a is JinjaUndefined) && (b == nil || b is NSNull || b is JinjaUndefined) { return true }
  if let ax = number(a), let bx = number(b) { return ax == bx }
  if let av = a as? String, let bv = b as? String { return av == bv }
  if let av = a as? Bool, let bv = b as? Bool { return av == bv }
  return false
}

private func toIndex(_ value: Any?) -> Int? {
  if let int = integer(value) { return Int(int) }
  if let double = number(value) { return Int(double) }
  if let string = value as? String { return Int(string) }
  return nil
}

private func integer(_ value: Any?) -> Int64? {
  if let number = value as? NSNumber, !isBoolNumber(number) {
    let double = number.doubleValue
    if double.rounded() == double { return number.int64Value }
    return nil
  }
  if let int = value as? Int { return Int64(int) }
  if let int = value as? Int64 { return int }
  return nil
}

private func number(_ value: Any?) -> Double? {
  if let number = value as? NSNumber, !isBoolNumber(number) { return number.doubleValue }
  if let double = value as? Double { return double }
  if let int = value as? Int { return Double(int) }
  if let int = value as? Int64 { return Double(int) }
  return nil
}

private func isBoolNumber(_ number: NSNumber) -> Bool {
  let type = String(cString: number.objCType)
  return type == "c" || type == "B"
}

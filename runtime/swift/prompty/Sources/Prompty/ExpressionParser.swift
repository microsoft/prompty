/// Evaluates the expression grammar used inside `{{ … }}` and `{% if … %}`.
///
/// Prompt templates routinely branch on comparisons (`{% if score > 3 %}`),
/// membership (`{% if role in allowed %}`) and negation (`{% if not draft %}`).
/// Treating those as opaque variable names resolves them to `nil`, which is
/// falsy — so the template silently renders the wrong branch instead of
/// failing. This parser exists to make that class of bug impossible: anything
/// it cannot evaluate is rejected loudly.
///
/// Precedence, lowest to highest, follows Jinja:
/// `or` → `and` → `not` → comparison / `in` / `is` → `~` → `+ -` → `* / // %`
/// → unary `-` → filters, member access, indexing.
import Foundation

enum ExpressionParser {

  static func evaluate(
    _ source: String,
    scope: [String: Any],
    filter: @escaping (String, [Any?], Any?) throws -> Any?
  ) throws -> Any? {
    var parser = Parser(source: source, scope: scope, filter: filter)
    let value = try parser.parseExpression()
    try parser.expectEnd()
    return value
  }

  // MARK: - Tokenizer

  enum Token: Equatable {
    case identifier(String)
    case string(String)
    case number(Double, isInteger: Bool)
    case symbol(String)
  }

  static func tokenize(_ source: String) throws -> [Token] {
    var tokens: [Token] = []
    let characters = Array(source)
    var index = 0

    // Multi-character operators must be matched before their prefixes, or
    // `<=` would tokenize as `<` followed by `=`.
    let operators = [
      "//", "==", "!=", "<=", ">=", "**", "|", "(", ")", "[", "]", ",", ".",
      "+", "-", "*", "/", "%", "<", ">", "~",
    ]

    while index < characters.count {
      let character = characters[index]

      if character.isWhitespace {
        index += 1
        continue
      }

      if character == "\"" || character == "'" {
        let quote = character
        index += 1
        var value = ""
        while index < characters.count, characters[index] != quote {
          // Backslash escapes keep quoted punctuation out of the operator path.
          if characters[index] == "\\", index + 1 < characters.count {
            index += 1
          }
          value.append(characters[index])
          index += 1
        }
        guard index < characters.count else {
          throw InvokerError.parse("unterminated string in expression '\(source)'")
        }
        index += 1
        tokens.append(.string(value))
        continue
      }

      if character.isNumber {
        var text = ""
        var isInteger = true
        while index < characters.count, characters[index].isNumber || characters[index] == "." {
          // A trailing dot is member access on a number literal, not a decimal
          // point, so only consume it when a digit follows.
          if characters[index] == "." {
            guard isInteger, index + 1 < characters.count, characters[index + 1].isNumber else {
              break
            }
            isInteger = false
          }
          text.append(characters[index])
          index += 1
        }
        guard let number = Double(text) else {
          throw InvokerError.parse("invalid number '\(text)' in expression '\(source)'")
        }
        tokens.append(.number(number, isInteger: isInteger))
        continue
      }

      if character.isLetter || character == "_" {
        var text = ""
        while index < characters.count,
          characters[index].isLetter || characters[index].isNumber || characters[index] == "_"
        {
          text.append(characters[index])
          index += 1
        }
        tokens.append(.identifier(text))
        continue
      }

      if let match = operators.first(where: { matches($0, characters, at: index) }) {
        tokens.append(.symbol(match))
        index += match.count
        continue
      }

      throw InvokerError.parse("unexpected character '\(character)' in expression '\(source)'")
    }

    return tokens
  }

  private static func matches(_ candidate: String, _ characters: [Character], at index: Int) -> Bool
  {
    let symbol = Array(candidate)
    guard index + symbol.count <= characters.count else { return false }
    for offset in 0..<symbol.count where characters[index + offset] != symbol[offset] {
      return false
    }
    return true
  }

  // MARK: - Parser

  private struct Parser {
    let tokens: [Token]
    let source: String
    let scope: [String: Any]
    let filter: (String, [Any?], Any?) throws -> Any?
    var position = 0

    init(
      source: String, scope: [String: Any],
      filter: @escaping (String, [Any?], Any?) throws -> Any?
    ) {
      self.tokens = (try? ExpressionParser.tokenize(source)) ?? []
      self.source = source
      self.scope = scope
      self.filter = filter
    }

    var current: Token? { position < tokens.count ? tokens[position] : nil }

    mutating func expectEnd() throws {
      guard position >= tokens.count else {
        throw InvokerError.parse("unparsed trailing input in expression '\(source)'")
      }
    }

    mutating func consume(symbol: String) -> Bool {
      guard current == .symbol(symbol) else { return false }
      position += 1
      return true
    }

    mutating func consume(identifier: String) -> Bool {
      guard current == .identifier(identifier) else { return false }
      position += 1
      return true
    }

    // MARK: Precedence levels

    mutating func parseExpression() throws -> Any? { try parseOr() }

    mutating func parseOr() throws -> Any? {
      var left = try parseAnd()
      while consume(identifier: "or") {
        let right = try parseAnd()
        // Jinja's `or` yields the operand, not a boolean.
        left = JSONSupport.isTruthy(left) ? left : right
      }
      return left
    }

    mutating func parseAnd() throws -> Any? {
      var left = try parseNot()
      while consume(identifier: "and") {
        let right = try parseNot()
        left = JSONSupport.isTruthy(left) ? right : left
      }
      return left
    }

    mutating func parseNot() throws -> Any? {
      if consume(identifier: "not") {
        return !JSONSupport.isTruthy(try parseNot())
      }
      return try parseComparison()
    }

    mutating func parseComparison() throws -> Any? {
      let left = try parseConcat()

      if consume(identifier: "is") {
        let negated = consume(identifier: "not")
        guard case .identifier(let test)? = current else {
          throw InvokerError.parse("expected a test after 'is' in '\(source)'")
        }
        position += 1
        let result = try applyTest(test, to: left)
        return negated ? !result : result
      }

      if consume(identifier: "in") {
        return contains(try parseConcat(), left)
      }
      if consume(identifier: "not") {
        guard consume(identifier: "in") else {
          throw InvokerError.parse("expected 'in' after 'not' in '\(source)'")
        }
        return !contains(try parseConcat(), left)
      }

      for symbol in ["==", "!=", "<=", ">=", "<", ">"] where consume(symbol: symbol) {
        return try compare(symbol, left, try parseConcat())
      }
      return left
    }

    mutating func parseConcat() throws -> Any? {
      var left = try parseAdditive()
      while consume(symbol: "~") {
        left = JSONSupport.stringify(left) + JSONSupport.stringify(try parseAdditive())
      }
      return left
    }

    mutating func parseAdditive() throws -> Any? {
      var left = try parseMultiplicative()
      while true {
        if consume(symbol: "+") {
          let right = try parseMultiplicative()
          // `+` concatenates when either side is a string, matching Jinja.
          if left is String || right is String {
            left = JSONSupport.stringify(left) + JSONSupport.stringify(right)
          } else if let a = left as? [Any], let b = right as? [Any] {
            left = a + b
          } else {
            left = try arithmetic("+", left, right)
          }
        } else if consume(symbol: "-") {
          left = try arithmetic("-", left, try parseMultiplicative())
        } else {
          return left
        }
      }
    }

    mutating func parseMultiplicative() throws -> Any? {
      var left = try parseUnary()
      while true {
        if let symbol = ["*", "//", "/", "%"].first(where: { current == .symbol($0) }) {
          position += 1
          left = try arithmetic(symbol, left, try parseUnary())
        } else {
          return left
        }
      }
    }

    mutating func parseUnary() throws -> Any? {
      if consume(symbol: "-") {
        return try arithmetic("-", 0, try parseUnary())
      }
      if consume(symbol: "+") {
        return try parseUnary()
      }
      return try parsePostfix()
    }

    /// Member access, indexing, and filters all bind tighter than operators.
    mutating func parsePostfix() throws -> Any? {
      var value = try parsePrimary()

      while let token = current {
        if token == .symbol(".") {
          position += 1
          guard case .identifier(let name)? = current else {
            throw InvokerError.parse("expected a property name after '.' in '\(source)'")
          }
          position += 1
          value = member(name, of: value)
        } else if token == .symbol("[") {
          position += 1
          let index = try parseExpression()
          guard consume(symbol: "]") else {
            throw InvokerError.parse("expected ']' in '\(source)'")
          }
          value = subscriptValue(value, by: index)
        } else if token == .symbol("|") {
          position += 1
          guard case .identifier(let name)? = current else {
            throw InvokerError.parse("expected a filter name after '|' in '\(source)'")
          }
          position += 1
          var arguments: [Any?] = []
          if consume(symbol: "(") {
            if !consume(symbol: ")") {
              repeat { arguments.append(try parseExpression()) } while consume(symbol: ",")
              guard consume(symbol: ")") else {
                throw InvokerError.parse("expected ')' after filter arguments in '\(source)'")
              }
            }
          }
          value = try filter(name, arguments, value)
        } else {
          break
        }
      }
      return value
    }

    mutating func parsePrimary() throws -> Any? {
      guard let token = current else {
        throw InvokerError.parse("unexpected end of expression '\(source)'")
      }

      switch token {
      case .number(let value, let isInteger):
        position += 1
        return isInteger ? Int(value) : value

      case .string(let value):
        position += 1
        return value

      case .identifier(let name):
        position += 1
        switch name {
        case "true", "True": return true
        case "false", "False": return false
        case "none", "None", "null": return nil
        default: return scope[name]
        }

      case .symbol("("):
        position += 1
        let value = try parseExpression()
        guard consume(symbol: ")") else {
          throw InvokerError.parse("expected ')' in '\(source)'")
        }
        return value

      case .symbol("["):
        position += 1
        var elements: [Any] = []
        if !consume(symbol: "]") {
          repeat { elements.append(try parseExpression() ?? NSNull()) } while consume(symbol: ",")
          guard consume(symbol: "]") else {
            throw InvokerError.parse("expected ']' in '\(source)'")
          }
        }
        return elements

      case .symbol(let symbol):
        throw InvokerError.parse("unexpected '\(symbol)' in expression '\(source)'")
      }
    }

    // MARK: Operations

    func member(_ name: String, of value: Any?) -> Any? {
      if let dictionary = value as? [String: Any] { return dictionary[name] }
      // Jinja allows `list.0`; mirror that for numeric members.
      if let array = value as? [Any], let index = Int(name) {
        return index >= 0 && index < array.count ? array[index] : nil
      }
      return nil
    }

    func subscriptValue(_ value: Any?, by index: Any?) -> Any? {
      if let key = index as? String { return member(key, of: value) }
      guard let array = value as? [Any], let position = index as? Int else { return nil }
      // Negative indices count from the end, as in Python.
      let resolved = position < 0 ? array.count + position : position
      return resolved >= 0 && resolved < array.count ? array[resolved] : nil
    }

    func applyTest(_ name: String, to value: Any?) throws -> Bool {
      switch name {
      case "defined": return value != nil && !(value is NSNull)
      case "undefined": return value == nil || value is NSNull
      case "none", "null": return value == nil || value is NSNull
      case "string": return value is String
      case "number": return value is Int || value is Double
      case "boolean": return value is Bool
      case "sequence", "iterable": return value is [Any]
      case "mapping": return value is [String: Any]
      case "even", "odd":
        guard let int = value as? Int else { return false }
        return name == "even" ? int % 2 == 0 : int % 2 != 0
      default:
        throw InvokerError.parse("unsupported template test '\(name)'")
      }
    }

    func contains(_ container: Any?, _ needle: Any?) -> Bool {
      if let string = container as? String {
        return string.contains(JSONSupport.stringify(needle))
      }
      if let dictionary = container as? [String: Any], let key = needle as? String {
        return dictionary[key] != nil
      }
      if let array = container as? [Any] {
        return array.contains { JSONSupport.equals($0, needle) }
      }
      return false
    }

    func compare(_ symbol: String, _ left: Any?, _ right: Any?) throws -> Bool {
      if symbol == "==" { return JSONSupport.equals(left, right) }
      if symbol == "!=" { return !JSONSupport.equals(left, right) }

      // Ordering is defined for numbers and strings only; anything else is a
      // template bug worth surfacing rather than silently reporting `false`.
      if let a = numeric(left), let b = numeric(right) {
        switch symbol {
        case "<": return a < b
        case "<=": return a <= b
        case ">": return a > b
        default: return a >= b
        }
      }
      if let a = left as? String, let b = right as? String {
        switch symbol {
        case "<": return a < b
        case "<=": return a <= b
        case ">": return a > b
        default: return a >= b
        }
      }
      throw InvokerError.parse(
        "cannot compare \(JSONSupport.stringify(left)) \(symbol) \(JSONSupport.stringify(right))"
          + " in '\(source)'")
    }

    func arithmetic(_ symbol: String, _ left: Any?, _ right: Any?) throws -> Any? {
      guard let a = numeric(left), let b = numeric(right) else {
        throw InvokerError.parse(
          "cannot apply '\(symbol)' to \(JSONSupport.stringify(left))"
            + " and \(JSONSupport.stringify(right)) in '\(source)'")
      }

      let bothIntegers = isInteger(left) && isInteger(right)
      switch symbol {
      case "+": return bothIntegers ? Int(a + b) as Any : a + b
      case "-": return bothIntegers ? Int(a - b) as Any : a - b
      case "*": return bothIntegers ? Int(a * b) as Any : a * b
      case "/":
        guard b != 0 else { throw InvokerError.parse("division by zero in '\(source)'") }
        return a / b
      case "//":
        guard b != 0 else { throw InvokerError.parse("division by zero in '\(source)'") }
        return Int((a / b).rounded(.down))
      case "%":
        guard b != 0 else { throw InvokerError.parse("division by zero in '\(source)'") }
        return bothIntegers
          ? Int(a.truncatingRemainder(dividingBy: b)) as Any
          : a.truncatingRemainder(dividingBy: b)
      default:
        throw InvokerError.parse("unsupported operator '\(symbol)' in '\(source)'")
      }
    }

    func numeric(_ value: Any?) -> Double? {
      switch value {
      case let int as Int: return Double(int)
      case let double as Double: return double
      case let number as NSNumber: return number.doubleValue
      default: return nil
      }
    }

    func isInteger(_ value: Any?) -> Bool {
      if value is Int { return true }
      if let number = value as? NSNumber {
        return
          !(number.doubleValue.truncatingRemainder(
            dividingBy: 1) != 0) && !(value is Double)
      }
      return false
    }
  }
}

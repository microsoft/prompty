import Foundation

/// Helpers for working with the loosely-typed `Any` values that the
/// Typra-generated model uses for free-form data (`metadata`, `inputs`,
/// raw provider payloads, and template values).
///
/// The generated model is the canonical type layer, so the runtime deliberately
/// does not introduce a parallel `JSONValue` domain type. These functions supply
/// the few operations — truthiness, rendering, deep equality, path lookup —
/// that `Any` cannot provide on its own.
public enum JSONSupport {

  /// Normalize a decoded value so that `NSNumber`/`NSNull` bridges behave
  /// predictably regardless of whether the value came from JSON or YAML.
  public static func normalize(_ value: Any?) -> Any? {
    guard let value else { return nil }
    if value is NSNull { return nil }
    if let number = value as? NSNumber {
      if isBool(number) { return number.boolValue }
      let double = number.doubleValue
      if double.rounded() == double && abs(double) < 9.007_199_254_740_992e15 {
        return Int(double)
      }
      return double
    }
    if let dict = value as? [String: Any] {
      var result: [String: Any] = [:]
      for (key, element) in dict {
        // A null-valued key is data, not absence: dropping it makes `raw_json`
        // lossy and breaks equality against runtimes that preserve it. Arrays
        // already keep their nulls, so keeping them here makes the two paths
        // agree.
        result[key] = normalize(element) ?? NSNull()
      }
      return result
    }
    if let array = value as? [Any] {
      return array.map { normalize($0) ?? NSNull() }
    }
    return value
  }

  private static func isBool(_ number: NSNumber) -> Bool {
    // Foundation stores booleans as NSNumber; the encoded Objective-C type is
    // the portable way to tell them apart from integers on every platform.
    let encoding = String(cString: number.objCType)
    return encoding == "c" || encoding == "B"
  }

  /// Jinja/Mustache truthiness: `nil`, `false`, `0`, `""`, and empty
  /// collections are falsy; everything else is truthy.
  public static func isTruthy(_ value: Any?) -> Bool {
    guard let value = normalize(value) else { return false }
    switch value {
    case let bool as Bool: return bool
    case let int as Int: return int != 0
    case let double as Double: return double != 0
    case let string as String: return !string.isEmpty
    case let array as [Any]: return !array.isEmpty
    case let dict as [String: Any]: return !dict.isEmpty
    case is NSNull: return false
    default: return true
    }
  }

  /// Render a value the way a template engine would interpolate it.
  ///
  /// Missing values render as the empty string, integral doubles lose their
  /// trailing `.0`, and containers fall back to compact JSON.
  public static func stringify(_ value: Any?) -> String {
    guard let value = normalize(value) else { return "" }
    switch value {
    case let string as String: return string
    case let bool as Bool: return bool ? "true" : "false"
    case let int as Int: return String(int)
    case let double as Double:
      if double.rounded() == double && abs(double) < 1e15 {
        return String(Int(double))
      }
      return String(double)
    case is NSNull: return ""
    default:
      if let data = try? JSONSerialization.data(
        withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed]),
        let text = String(data: data, encoding: .utf8)
      {
        return text
      }
      return String(describing: value)
    }
  }

  /// Look up a dotted path such as `user.name` or `items.0` in a value tree.
  public static func lookup(_ path: String, in root: Any?) -> Any? {
    var current = normalize(root)
    for segment in path.split(separator: ".") {
      guard let value = current else { return nil }
      if let dict = value as? [String: Any] {
        current = normalize(dict[String(segment)])
      } else if let array = value as? [Any], let index = Int(segment),
        index >= 0, index < array.count
      {
        current = normalize(array[index])
      } else {
        return nil
      }
    }
    return current
  }

  /// Structural equality across the `Any` values the model uses.
  public static func equals(_ lhs: Any?, _ rhs: Any?) -> Bool {
    let left = normalize(lhs)
    let right = normalize(rhs)
    switch (left, right) {
    case (nil, nil): return true
    case (nil, _), (_, nil): return false
    default: break
    }
    if let l = left as? Bool, let r = right as? Bool { return l == r }
    if let l = left as? String, let r = right as? String { return l == r }
    if let l = numeric(left), let r = numeric(right) { return l == r }
    if let l = left as? [Any], let r = right as? [Any] {
      guard l.count == r.count else { return false }
      return zip(l, r).allSatisfy { equals($0, $1) }
    }
    if let l = left as? [String: Any], let r = right as? [String: Any] {
      guard l.count == r.count else { return false }
      return l.allSatisfy { key, value in r[key] != nil && equals(value, r[key]) }
    }
    return false
  }

  private static func numeric(_ value: Any?) -> Double? {
    switch value {
    case let int as Int: return Double(int)
    case let double as Double: return double
    default: return nil
    }
  }

  /// Parse a JSON string into normalized `Any`.
  public static func parse(json: String) -> Any? {
    guard let data = json.data(using: .utf8),
      let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    else { return nil }
    return normalize(value)
  }

  /// Serialize a value to compact JSON, or `"null"` when it cannot be encoded.
  public static func toJSON(_ value: Any?) -> String {
    guard let value = normalize(value) else { return "null" }
    if let data = try? JSONSerialization.data(
      withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed]),
      let text = String(data: data, encoding: .utf8)
    {
      return text
    }
    return "null"
  }
}

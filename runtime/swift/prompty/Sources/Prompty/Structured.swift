import Foundation

/// Transport for structured (schema-shaped) results.
///
/// When a prompt declares `outputs`, a processed object or array is wrapped so
/// that the exact provider JSON survives alongside the parsed value. Callers
/// that just want the data see it through ``unwrap(_:)``; callers that need a
/// lossless round-trip decode ``cast(_:as:)`` from the preserved raw JSON.
import PromptyModel

public enum Structured {

  /// Wrap a processed result when the prompt declares outputs.
  public static func wrapIfNeeded(_ agent: Agent, result: Any?) -> Any? {
    guard agent.hasStructuredOutputs else { return result }
    guard result is [String: Any] || result is [Any] else { return result }

    return [
      Defaults.structuredMarker: true,
      "data": result as Any,
      "raw_json": JSONSupport.toJSON(result),
    ]
  }

  /// Whether a value is a structured transport envelope.
  public static func isStructured(_ value: Any?) -> Bool {
    guard let dict = value as? [String: Any] else { return false }
    return JSONSupport.isTruthy(dict[Defaults.structuredMarker])
  }

  /// Unwrap the envelope, returning the payload. Non-envelopes pass through.
  public static func unwrap(_ value: Any?) -> Any? {
    guard isStructured(value), let dict = value as? [String: Any] else { return value }
    return dict["data"]
  }

  /// The preserved raw provider JSON, when present.
  public static func rawJSON(_ value: Any?) -> String? {
    guard isStructured(value), let dict = value as? [String: Any] else { return nil }
    return dict["raw_json"] as? String
  }

  /// Decode a structured result into a `Decodable` type.
  ///
  /// The preserved raw JSON is preferred so nothing is lost re-encoding the
  /// intermediate representation.
  public static func cast<T: Decodable>(_ value: Any?, as type: T.Type) throws -> T {
    let json: String
    if let raw = rawJSON(value) {
      json = raw
    } else if let text = unwrap(value) as? String {
      // A bare string result is already JSON text. Re-encoding it would
      // produce a JSON *string literal* and decoding into a structure would
      // then fail, so it is used verbatim.
      json = text
    } else {
      json = JSONSupport.toJSON(unwrap(value))
    }

    guard let data = json.data(using: .utf8) else {
      throw InvokerError.processing("result is not valid UTF-8")
    }
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      throw InvokerError.processing("failed to decode structured result: \(error)")
    }
  }

  /// Build a JSON Schema from a prompt's declared outputs.
  ///
  /// Providers use this to request schema-constrained responses. Structured
  /// output is always strict.
  public static func outputSchema(_ agent: Agent) throws -> [String: Any]? {
    let outputs = agent.outputProperties
    guard !outputs.isEmpty else { return nil }
    return try JSONSchema.outputs(outputs)
  }
}

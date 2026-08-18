import Foundation

/// Raised when a portable `Property` cannot be represented safely by the
/// provider's JSON Schema subset.
import PromptyModel

/// Projection of the portable `Property` model onto JSON Schema.
///
/// This mirrors the Rust reference implementation exactly so that every runtime
/// produces byte-identical request bodies for the shared wire vectors.
public struct SchemaError: Error, CustomStringConvertible, Equatable {
  public let message: String

  public init(_ message: String) {
    self.message = message
  }

  public var description: String { message }

  static let invalidUnion = SchemaError(
    "UnionProperty must contain exactly one non-empty `oneOf` or `anyOf` array"
  )

  static let unsupportedOneOf = SchemaError(
    "OpenAI schemas do not support UnionProperty.oneOf; use the provider-supported anyOf composition"
  )
}
public enum JSONSchema {

  /// Map a Prompty property kind onto its JSON Schema type.
  ///
  /// Unrecognized kinds return `nil`; the caller then emits a bare `{}` so
  /// provider-specific extension kinds degrade to "any value" rather than being
  /// silently coerced to a string.
  public static func jsonType(forKind kind: String) -> String? {
    switch kind {
    case "string": return "string"
    case "integer": return "integer"
    case "float", "number": return "number"
    case "boolean": return "boolean"
    case "array": return "array"
    case "object": return "object"
    default: return nil
    }
  }

  /// Convert one property into a recursive JSON Schema definition.
  public static func schema(for property: Property, strict: Bool) throws -> [String: Any] {
    var schema: [String: Any] = [:]

    if let type = jsonType(forKind: property.kindName) {
      schema["type"] = type
    }
    if let description = property.propertyDescription, !description.isEmpty {
      schema["description"] = description
    }
    if let values = property.enumValues {
      schema["enum"] = values
    }

    switch property.kindName {
    case "array":
      if let items = property.arrayItems, !(items.raw.isEmpty) {
        schema["items"] = try JSONSchema.schema(for: items, strict: strict)
      }

    case "object":
      let children = property.objectProperties
      if !children.isEmpty {
        var nested: [String: Any] = [:]
        var required: [String] = []
        for child in children where !child.name.isEmpty {
          nested[child.name] = try JSONSchema.schema(
            for: child, optional: !child.isRequired, strict: strict)
          if child.isRequired { required.append(child.name) }
        }
        schema["properties"] = nested
        if !required.isEmpty { schema["required"] = required }
        schema["additionalProperties"] = false
      }

    case "union":
      let oneOf = property.unionOneOf
      let anyOf = property.unionAnyOf
      switch (!oneOf.isEmpty, !anyOf.isEmpty) {
      case (true, false):
        throw SchemaError.unsupportedOneOf
      case (false, true):
        schema["anyOf"] = try anyOf.map { try JSONSchema.schema(for: $0, strict: strict) }
      default:
        throw SchemaError.invalidUnion
      }

    default:
      break
    }

    if property.isNullable {
      addNullability(&schema)
    }
    return schema
  }

  /// Convert a property that sits in an optional position.
  ///
  /// In strict mode every declared key must appear in `required`, so optional
  /// members express their optionality through a nullable type instead.
  public static func schema(
    for property: Property, optional: Bool, strict: Bool
  ) throws -> [String: Any] {
    var result = try schema(for: property, strict: strict)
    if strict, optional, !property.isNullable {
      addNullability(&result)
    }
    return result
  }

  /// Widen a schema so it also accepts JSON `null`.
  public static func addNullability(_ schema: inout [String: Any]) {
    if let type = schema["type"] as? String {
      schema["type"] = [type, "null"]
    } else if var branches = schema["anyOf"] as? [Any] {
      branches.append(["type": "null"])
      schema["anyOf"] = branches
    } else if !schema.isEmpty {
      // The branch is built from a snapshot taken *before* insertion, and the
      // `anyOf` key is added to the existing map rather than replacing it, so
      // siblings such as `description` survive and the `enum` widening below
      // still sees the original values.
      let snapshot = schema
      schema["anyOf"] = [snapshot, ["type": "null"]]
    }

    if var values = schema["enum"] as? [Any] {
      if !values.contains(where: { $0 is NSNull }) {
        values.append(NSNull())
        schema["enum"] = values
      }
    }
  }

  /// Build the `parameters` object schema for a tool.
  public static func parameters(_ properties: [Property], strict: Bool) throws -> [String: Any] {
    var fields: [String: Any] = [:]
    var required: [String] = []

    for property in properties {
      fields[property.name] = try schema(
        for: property, optional: !property.isRequired, strict: strict)
      if strict || property.isRequired {
        required.append(property.name)
      }
    }

    var schema: [String: Any] = ["type": "object", "properties": fields]
    if !required.isEmpty { schema["required"] = required }
    return schema
  }

  /// Build the strict object schema used for structured output.
  ///
  /// Structured output is always strict: every declared output is listed in
  /// `required` and additional keys are rejected.
  public static func outputs(_ properties: [Property]) throws -> [String: Any] {
    var fields: [String: Any] = [:]
    var required: [String] = []

    for property in properties {
      fields[property.name] = try schema(
        for: property, optional: !property.isRequired, strict: true)
      required.append(property.name)
    }

    var schema: [String: Any] = ["type": "object", "properties": fields]
    if !required.isEmpty { schema["required"] = required }
    schema["additionalProperties"] = false
    return schema
  }
}

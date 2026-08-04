import Foundation

// Convenience accessors over the Typra-generated model.
//
// These are extensions only — the generated types remain the single canonical
// domain layer. Nothing here redefines or shadows a generated type.

import PromptyModel

extension Property {
  /// The property's raw frontmatter dictionary.
  ///
  /// Scalar kinds are preserved verbatim by the generated `Property.unknown`
  /// case; the three declared subtypes round-trip through `save()`.
  public var raw: [String: Any] {
    switch self {
    case .unknown(let dict): return dict
    default: return (try? save()) ?? [:]
    }
  }

  /// The declared property name, or `""` when unnamed.
  public var name: String { raw["name"] as? String ?? "" }

  /// The property's `kind` discriminator (`string`, `integer`, `thread`, ...).
  public var kindName: String { raw["kind"] as? String ?? "" }

  /// A human-readable description, when declared.
  public var propertyDescription: String? { raw["description"] as? String }

  /// Whether the property must be supplied by the caller.
  public var isRequired: Bool { JSONSupport.isTruthy(raw["required"]) }

  /// The declared default, used to fill omitted inputs.
  public var defaultValue: Any? { JSONSupport.normalize(raw["default"]) }

  /// The declared example. Examples are documentation only and are never used
  /// to fill an omitted input.
  public var exampleValue: Any? { JSONSupport.normalize(raw["example"]) }

  /// Allowed enumeration values, when declared.
  public var enumValues: [Any]? {
    guard let values = raw["enumValues"] as? [Any], !values.isEmpty else { return nil }
    return values.map { JSONSupport.normalize($0) ?? NSNull() }
  }

  /// Whether the property also accepts a JSON `null`.
  public var isNullable: Bool { JSONSupport.isTruthy(raw["nullable"]) }

  /// The element schema of an `array` property, when declared.
  public var arrayItems: Property? {
    if case .arrayProperty(let array) = self { return array.items }
    guard let items = raw["items"] else { return nil }
    return try? Property.load(items)
  }

  /// The child properties of an `object` property.
  public var objectProperties: [Property] {
    if case .objectProperty(let object) = self { return object.properties }
    guard let nested = raw["properties"] as? [Any] else { return [] }
    // `try?` deliberately drops a structurally invalid child: `build()` already
    // rejects those upstream, so this only fires for hand-built `Property`
    // values that never went through the loader.
    return nested.compactMap { try? Property.load(Loader.normalizeProperty($0)) }
  }

  /// The `oneOf` branches of a `union` property, when declared.
  public var unionOneOf: [Property] {
    if case .unionProperty(let union) = self { return union.oneOf ?? [] }
    guard let branches = raw["oneOf"] as? [Any] else { return [] }
    return branches.compactMap { try? Property.load($0) }
  }

  /// The `anyOf` branches of a `union` property, when declared.
  public var unionAnyOf: [Property] {
    if case .unionProperty(let union) = self { return union.anyOf ?? [] }
    guard let branches = raw["anyOf"] as? [Any] else { return [] }
    return branches.compactMap { try? Property.load($0) }
  }
}
extension Tool {
  /// The tool's raw dictionary form.
  public var raw: [String: Any] { (try? save()) ?? [:] }

  /// The declared tool name.
  public var name: String { raw["name"] as? String ?? "" }

  /// The tool's `kind` discriminator (`function`, `mcp`, `openapi`, ...).
  public var kindName: String { raw["kind"] as? String ?? "" }

  /// A human-readable description, when declared.
  public var toolDescription: String? {
    guard let value = raw["description"] as? String, !value.isEmpty else { return nil }
    return value
  }

  /// The tool's declared bindings, whichever concrete kind it is.
  ///
  /// `bindings` is inherited by every tool kind, but the generated `Tool` enum
  /// reaches it only through its payload, so the switch lives here once.
  public var bindings: [Binding] {
    switch self {
    case .functionTool(let tool): return tool.bindings ?? []
    case .mcpTool(let tool): return tool.bindings ?? []
    case .openApiTool(let tool): return tool.bindings ?? []
    case .promptyTool(let tool): return tool.bindings ?? []
    case .customTool(let tool): return tool.bindings ?? []
    }
  }

  /// Parameter names bound to inputs. Bound parameters are stripped from the
  /// schema sent to the provider — the runtime supplies them instead.
  ///
  /// An unnamed binding targets no parameter, so it strips nothing; that is the
  /// same binding ``Pipeline/applyBindings(_:toolName:arguments:inputs:)``
  /// declines to inject, and the two must agree or a parameter would be removed
  /// from the schema and never restored.
  public var boundParameterNames: Set<String> {
    Set(bindings.map(\.name).filter { !$0.isEmpty })
  }

  /// The declared function parameters, for `function` tools.
  public var functionParameters: [Property] {
    if case .functionTool(let tool) = self { return tool.parameters }
    return []
  }

  /// Whether the tool declares strict schema adherence.
  public var isStrict: Bool {
    if case .functionTool(let tool) = self { return tool.strict ?? false }
    return false
  }
}
extension Prompty {
  /// The renderer key: `template.format.kind`, defaulting to `jinja2`.
  ///
  /// The generated model defaults `kind` to the wildcard sentinel `"*"`, which
  /// means "unconstrained" in the schema and is never a registry key. A prompt
  /// that sets only one side of `template` therefore leaves the other holding
  /// `"*"`, which must resolve to the runtime default rather than fail lookup.
  public var formatKind: String {
    Self.resolveKind(template?.format.kind, default: Defaults.templateFormat)
  }

  /// The parser key: `template.parser.kind`, defaulting to `prompty`.
  public var parserKind: String {
    Self.resolveKind(template?.parser.kind, default: Defaults.parser)
  }

  private static func resolveKind(_ kind: String?, default fallback: String) -> String {
    guard let kind, !kind.isEmpty, kind != "*" else { return fallback }
    return kind
  }

  /// The executor/processor key: `model.provider`, defaulting to `openai`.
  public var providerKind: String {
    guard let provider = model.provider, !provider.isEmpty else { return Defaults.provider }
    return provider
  }

  /// The API surface to call: `model.apiType`, defaulting to `chat`.
  public var apiTypeName: String {
    let name = model.apiType?.rawValue ?? ""
    return name.isEmpty ? "chat" : name
  }

  /// Whether the prompt asks the provider to stream its response.
  public var isStreaming: Bool {
    JSONSupport.isTruthy(model.options?.additionalProperties?["stream"])
  }

  /// Declared inputs, or an empty list.
  public var inputProperties: [Property] { inputs ?? [] }

  /// Declared outputs, or an empty list.
  public var outputProperties: [Property] { outputs ?? [] }

  /// Whether this prompt declares a structured output schema.
  public var hasStructuredOutputs: Bool { !(outputs ?? []).isEmpty }

  /// The absolute path this prompt was loaded from, when known.
  public var sourcePath: String? { metadata?[Defaults.sourcePathKey] as? String }
}
extension Message {
  /// Build a single-text-part message.
  public static func withText(_ role: Role, _ text: String) -> Message {
    Message(role: role, parts: [.textPart(TextPart(kind: "text", value: text))])
  }

  /// Build a `tool` role message carrying a tool call result.
  public static func toolResult(toolCallId: String, result: String) -> Message {
    Message(
      role: .tool,
      parts: [.textPart(TextPart(kind: "text", value: result))],
      metadata: ["tool_call_id": toolCallId]
    )
  }

  /// All text parts concatenated. Non-text parts are ignored.
  public var textContent: String {
    parts.compactMap { part -> String? in
      if case .textPart(let text) = part { return text.value }
      return nil
    }.joined()
  }

  /// Wire-shaped content: a plain string when every part is text (joined by
  /// newline), otherwise `nil` so the caller emits typed content blocks.
  public var plainTextWireContent: String? {
    guard !hasRichContent else { return nil }
    return parts.compactMap { part -> String? in
      if case .textPart(let text) = part { return text.value }
      return nil
    }.joined(separator: "\n")
  }

  /// Whether the message carries any non-text content part.
  public var hasRichContent: Bool {
    parts.contains { part in
      if case .textPart = part { return false }
      return true
    }
  }
}
extension ContentPart {
  /// Build a text content part.
  public static func text(_ value: String) -> ContentPart {
    .textPart(TextPart(kind: "text", value: value))
  }
}
extension Role {
  /// Parse a role string, returning `nil` rather than throwing.
  public static func parseOptional(_ value: String) -> Role? {
    try? Role.parse(value.lowercased())
  }
}

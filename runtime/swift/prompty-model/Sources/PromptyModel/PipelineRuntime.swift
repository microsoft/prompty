import Foundation
import Yams

public var promptyEnvironmentOverrides: [String: String?] = [:]

public struct PromptyLoadError: Error, CustomStringConvertible {
  public let kind: String
  public let field: String?
  public let message: String

  public init(kind: String, field: String? = nil, message: String) {
    self.kind = kind
    self.field = field
    self.message = message
  }

  public var description: String { message }
}

private let threadNoncePrefix = "__PROMPTY_THREAD_"
private let richKinds: Set<String> = ["thread", "image", "file", "audio"]

private func randomHex(_ bytes: Int) -> String {
  (0..<bytes).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
}

private func propertyNameKind(_ property: Property) -> (String, String) {
  guard let saved = try? property.save(SaveContext(collectionFormat: "object", useShorthand: false)) else {
    return ("", "")
  }
  return (saved["name"] as? String ?? "", saved["kind"] as? String ?? "")
}

public func prepareRenderInputs(agent: Agent?, inputs: [String: Any]) -> ([String: Any], [String: String]) {
  var renderInputs = inputs
  var nonces: [String: String] = [:]
  guard let agent else { return (renderInputs, nonces) }
  for property in agent.inputs ?? [] {
    let (name, kind) = propertyNameKind(property)
    guard !name.isEmpty, richKinds.contains(kind) else { continue }
    let nonce = "\(threadNoncePrefix)\(randomHex(4))_\(name)__"
    nonces[nonce] = name
    renderInputs[name] = nonce
  }
  return (renderInputs, nonces)
}

/// Extract the format discriminator from the generated FormatConfig coerce-union
/// enum by projecting it back to its wire dictionary and reading `kind`.
func formatEngine(_ agent: Agent?) -> String {
  guard let format = agent?.template?.format,
    let dict = try? format.save(),
    let kind = dict["kind"] as? String,
    !kind.isEmpty
  else {
    return "jinja2"
  }
  return kind
}

public func render(agent: Agent?, inputs: [String: Any]) throws -> (String, [String: String]) {
  let (renderInputs, nonces) = prepareRenderInputs(agent: agent, inputs: inputs)
  let template = agent?.instructions ?? ""
  let engine = formatEngine(agent)
  switch engine {
  case "jinja2":
    return (try render(template: template, inputs: renderInputs), nonces)
  case "mustache":
    return (renderMustache(template, renderInputs), nonces)
  default:
    throw TypraRuntimeError.unsupported("unsupported template engine \(engine)")
  }
}

private let mustachePattern = #"\{\{([#\^/]?)\s*([^}]*?)\s*\}\}"#

private func renderMustache(_ template: String, _ root: [String: Any]) -> String {
  renderMustacheNodes(template, [root])
}

private func mustacheLookup(_ stack: [Any], _ key: String) -> Any? {
  if key == "." { return stack.last }
  for item in stack.reversed() {
    if let map = item as? [String: Any], let value = map[key] { return value }
  }
  return nil
}

private func mustacheClassify(_ value: Any?) -> (Bool, [Any], Bool) {
  guard let value, !(value is NSNull) else { return (false, [], false) }
  if let bool = value as? Bool { return (bool, [], false) }
  if let string = value as? String { return (!string.isEmpty, [], false) }
  if let array = value as? [Any] { return (!array.isEmpty, array, true) }
  if let map = value as? [String: Any] { return (!map.isEmpty, [], false) }
  if let number = value as? NSNumber {
    if TypraRuntime.isBoolNumber(number) { return (number.boolValue, [], false) }
    return (number.doubleValue != 0, [], false)
  }
  return (true, [], false)
}

private func mustacheStringify(_ value: Any?) -> String {
  guard let value, !(value is NSNull) else { return "" }
  if let string = value as? String { return string }
  if let bool = value as? Bool { return bool ? "true" : "false" }
  if let number = value as? NSNumber {
    if TypraRuntime.isBoolNumber(number) { return number.boolValue ? "true" : "false" }
    return number.stringValue
  }
  return String(describing: value)
}

private func renderMustacheNodes(_ template: String, _ stack: [Any]) -> String {
  guard let regex = try? NSRegularExpression(pattern: mustachePattern) else { return template }
  var output = ""
  var index = template.startIndex
  while index < template.endIndex {
    let range = NSRange(index..<template.endIndex, in: template)
    guard let match = regex.firstMatch(in: template, range: range),
      let whole = Range(match.range(at: 0), in: template),
      let sigilRange = Range(match.range(at: 1), in: template),
      let keyRange = Range(match.range(at: 2), in: template)
    else {
      output += template[index...]
      break
    }
    output += template[index..<whole.lowerBound]
    let sigil = String(template[sigilRange])
    let key = String(template[keyRange])
    if sigil == "#" || sigil == "^" {
      let close = "{{/\(key)}}"
      let rest = template[whole.upperBound...]
      guard let closeRange = rest.range(of: close) else {
        output += template[whole.lowerBound...]
        break
      }
      let inner = String(rest[..<closeRange.lowerBound])
      let afterClose = closeRange.upperBound
      let (truthy, items, isList) = mustacheClassify(mustacheLookup(stack, key))
      if sigil == "#" {
        if isList {
          for item in items { output += renderMustacheNodes(inner, stack + [item]) }
        } else if truthy {
          var next = stack
          if let map = mustacheLookup(stack, key) as? [String: Any] { next.append(map) }
          output += renderMustacheNodes(inner, next)
        }
      } else if !truthy {
        output += renderMustacheNodes(inner, stack)
      }
      index = afterClose
      continue
    }
    output += mustacheStringify(mustacheLookup(stack, key))
    index = whole.upperBound
  }
  return output
}

private let roleMarkerRegex = try! NSRegularExpression(
  pattern: #"^(system|user|assistant|developer|tool)(\[.*?\])?:\s*$"#,
  options: [.anchorsMatchLines])
private let attrsRegex = try! NSRegularExpression(pattern: #"(\w+)\s*=\s*"?([^",\]]+)"?"#)
private let threadNonceRegex = try! NSRegularExpression(pattern: #"__PROMPTY_THREAD_[a-f0-9]{8}_(\w+)__"#)

public func parseMessages(_ rendered: String) -> [Message] {
  var messages: [Message] = []
  var currentRole = ""
  var haveRole = false
  var currentContent: [String] = []
  var currentAttrs: [String: Any] = [:]

  for line in rendered.components(separatedBy: "\n") {
    let nsRange = NSRange(line.startIndex..<line.endIndex, in: line)
    if let match = roleMarkerRegex.firstMatch(in: line, range: nsRange),
      let roleRange = Range(match.range(at: 1), in: line)
    {
      if haveRole { messages.append(createMessage(currentRole, currentContent, currentAttrs)) }
      currentRole = String(line[roleRange])
      haveRole = true
      if match.range(at: 2).location != NSNotFound, let attrsRange = Range(match.range(at: 2), in: line) {
        currentAttrs = parseAttributes(String(line[attrsRange]))
      } else {
        currentAttrs = [:]
      }
      currentContent = []
    } else {
      currentContent.append(line)
    }
  }

  if haveRole {
    messages.append(createMessage(currentRole, currentContent, currentAttrs))
  } else {
    let text = currentContent.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.isEmpty { messages.append(Message(role: .system, parts: [.textPart(TextPart(value: text))])) }
  }
  return messages
}

private func createMessage(_ role: String, _ lines: [String], _ attrs: [String: Any]) -> Message {
  let text = lines.joined(separator: "\n").trimmingCharacters(in: CharacterSet(charactersIn: "\r\n"))
  return Message(
    role: (try? Role.parse(role)) ?? .user,
    parts: [.textPart(TextPart(value: text))],
    metadata: attrs)
}

private func parseAttributes(_ group: String) -> [String: Any] {
  let inner = group.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
  guard !inner.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [:] }
  var attrs: [String: Any] = [:]
  let range = NSRange(inner.startIndex..<inner.endIndex, in: inner)
  for match in attrsRegex.matches(in: inner, range: range) {
    guard let keyRange = Range(match.range(at: 1), in: inner),
      let valueRange = Range(match.range(at: 2), in: inner)
    else { continue }
    attrs[String(inner[keyRange])] = coerceAttribute(String(inner[valueRange]))
  }
  return attrs
}

private func coerceAttribute(_ raw: String) -> Any {
  let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  if value.lowercased() == "true" { return true }
  if value.lowercased() == "false" { return false }
  if let int = Int(value) { return int }
  if let double = Double(value) { return double }
  return value
}

private func messageText(_ message: Message) -> String {
  var text = ""
  for part in message.parts {
    if case .textPart(let value) = part { text += value.value }
  }
  return text
}

public func expandThreadMarkers(_ messages: [Message], threadInputs: [String: [Message]]) -> [Message] {
  var result: [Message] = []
  for message in messages {
    let text = messageText(message)
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let match = threadNonceRegex.firstMatch(in: text, range: range),
      let fullRange = Range(match.range(at: 0), in: text),
      let nameRange = Range(match.range(at: 1), in: text),
      let threadMessages = threadInputs[String(text[nameRange])]
    else {
      result.append(message)
      continue
    }
    let before = text[..<fullRange.lowerBound].trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n"))
    let after = text[fullRange.upperBound...].trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n"))
    if !before.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      result.append(Message(role: message.role, parts: [.textPart(TextPart(value: String(before)))], metadata: message.metadata))
    }
    result.append(contentsOf: threadMessages)
    if !after.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      result.append(Message(role: message.role, parts: [.textPart(TextPart(value: String(after)))], metadata: message.metadata))
    }
  }
  return result
}

public func processResponse(provider: String, apiType: String, response: Any?, hasOutputs: Bool) -> Any? {
  let resp = response as? [String: Any] ?? [:]
  if provider == "anthropic" { return processAnthropicResponse(resp, hasOutputs: hasOutputs) }
  switch apiType {
  case "responses": return processOpenAIResponses(resp, hasOutputs: hasOutputs)
  case "embedding": return processOpenAIEmbedding(resp)
  case "image": return processOpenAIImage(resp)
  default: return processOpenAIChat(resp, hasOutputs: hasOutputs)
  }
}

private func maybeParseStructured(_ content: String, _ hasOutputs: Bool) -> Any {
  guard hasOutputs, let data = content.data(using: .utf8),
    let parsed = try? JSONSerialization.jsonObject(with: data)
  else { return content }
  return parsed
}

private func processOpenAIChat(_ resp: [String: Any], hasOutputs: Bool) -> Any {
  guard let choice = (resp["choices"] as? [[String: Any]])?.first,
    let message = choice["message"] as? [String: Any]
  else { return "" }
  if let toolCalls = message["tool_calls"] as? [[String: Any]], !toolCalls.isEmpty {
    return extractOpenAIToolCalls(toolCalls)
  }
  if let content = message["content"] as? String { return maybeParseStructured(content, hasOutputs) }
  if let refusal = message["refusal"] as? String, !refusal.isEmpty { return refusal }
  return ""
}

private func extractOpenAIToolCalls(_ calls: [[String: Any]]) -> [[String: Any]] {
  calls.map { tc in
    let fn = tc["function"] as? [String: Any] ?? [:]
    return ["id": tc["id"] ?? NSNull(), "name": fn["name"] ?? NSNull(), "arguments": fn["arguments"] ?? NSNull()]
  }
}

private func processOpenAIResponses(_ resp: [String: Any], hasOutputs: Bool) -> Any {
  var toolCalls: [[String: Any]] = []
  for item in resp["output"] as? [[String: Any]] ?? [] where (item["type"] as? String) == "function_call" {
    toolCalls.append(["id": item["call_id"] ?? NSNull(), "name": item["name"] ?? NSNull(), "arguments": item["arguments"] ?? NSNull()])
  }
  if !toolCalls.isEmpty { return toolCalls }
  return maybeParseStructured(resp["output_text"] as? String ?? "", hasOutputs)
}

private func processOpenAIEmbedding(_ resp: [String: Any]) -> Any {
  let data = resp["data"] as? [[String: Any]] ?? []
  if data.count == 1 { return data[0]["embedding"] ?? NSNull() }
  return data.map { $0["embedding"] ?? NSNull() }
}

private func processOpenAIImage(_ resp: [String: Any]) -> Any {
  guard let first = (resp["data"] as? [[String: Any]])?.first else { return "" }
  return (first["url"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    ?? (first["b64_json"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    ?? ""
}

private func processAnthropicResponse(_ resp: [String: Any], hasOutputs: Bool) -> Any {
  var toolCalls: [[String: Any]] = []
  var text = ""
  for block in resp["content"] as? [[String: Any]] ?? [] {
    switch block["type"] as? String {
    case "tool_use":
      let args = (try? jsonString(block["input"] ?? [:])) ?? "{}"
      toolCalls.append(["id": block["id"] ?? NSNull(), "name": block["name"] ?? NSNull(), "arguments": args])
    case "text":
      text += block["text"] as? String ?? ""
    default:
      break
    }
  }
  if !toolCalls.isEmpty { return toolCalls }
  return maybeParseStructured(text, hasOutputs)
}

public func buildWireRequest(_ input: [String: Any]) throws -> [String: Any] {
  let provider = input["provider"] as? String ?? ""
  let apiType = input["apiType"] as? String ?? "chat"
  let modelID = input["model_id"] as? String ?? ""
  let messages = input["messages"] as? [[String: Any]] ?? []
  let tools = input["tools"] as? [[String: Any]] ?? []
  let outputs = input["outputs"] as? [[String: Any]] ?? []
  let options = input["options"] as? [String: Any] ?? [:]
  if provider == "anthropic" { return buildAnthropicWire(modelID, messages, tools, options) }
  switch apiType {
  case "chat": return buildOpenAIChatWire(modelID, messages, tools, options, outputs)
  case "responses": return buildOpenAIResponsesWire(modelID, messages, tools, outputs)
  case "embedding": return buildOpenAIEmbeddingWire(modelID, messages)
  case "image": return buildOpenAIImageWire(modelID, messages)
  default: throw TypraRuntimeError.unsupported("unsupported apiType \(apiType) for wire request")
  }
}

private func buildOpenAIChatWire(_ modelID: String, _ messages: [[String: Any]], _ tools: [[String: Any]], _ options: [String: Any], _ outputs: [[String: Any]]) -> [String: Any] {
  var body: [String: Any] = ["model": modelID]
  applyOpenAIOptions(&body, options)
  body["messages"] = messages.map { ["role": $0["role"] ?? "", "content": openAIChatContent($0["content"] as? [[String: Any]] ?? [])] }
  if let wireTools = openAIChatTools(tools) { body["tools"] = wireTools }
  if !outputs.isEmpty {
    body["response_format"] = [
      "type": "json_schema",
      "json_schema": ["name": "structured_output", "strict": true, "schema": buildOutputSchema(outputs)],
    ]
  }
  return body
}

private func openAIChatContent(_ parts: [[String: Any]]) -> Any {
  if parts.count == 1, parts[0]["kind"] as? String == "text" { return parts[0]["value"] ?? "" }
  var arr: [[String: Any]] = []
  for part in parts {
    switch part["kind"] as? String {
    case "text":
      arr.append(["type": "text", "text": part["value"] ?? ""])
    case "image":
      arr.append(["type": "image_url", "image_url": ["url": partValue(part)]])
    case "audio":
      arr.append(["type": "input_audio", "input_audio": ["data": partValue(part), "format": audioFormat(part["mediaType"] as? String)]])
    default:
      break
    }
  }
  return arr
}

private func openAIChatTools(_ tools: [[String: Any]]) -> [[String: Any]]? {
  guard !tools.isEmpty else { return nil }
  return tools.map { tool in
    var fn: [String: Any] = ["name": tool["name"] ?? ""]
    if let desc = tool["description"] { fn["description"] = desc }
    let strict = tool["strict"] as? Bool ?? false
    fn["parameters"] = buildToolParamsSchema(tool["parameters"] as? [[String: Any]] ?? [], strict, tool["bindings"] as? [String: Any])
    if strict { fn["strict"] = true }
    return ["type": "function", "function": fn]
  }
}

private func buildOpenAIResponsesWire(_ modelID: String, _ messages: [[String: Any]], _ tools: [[String: Any]], _ outputs: [[String: Any]]) -> [String: Any] {
  var body: [String: Any] = ["model": modelID]
  var systemTexts: [String] = []
  var input: [[String: Any]] = []
  for msg in messages {
    let role = msg["role"] as? String ?? ""
    let parts = msg["content"] as? [[String: Any]] ?? []
    if role == "system" || role == "developer" {
      systemTexts.append(partsText(parts))
    } else {
      input.append(["role": role, "content": openAIChatContent(parts)])
    }
  }
  if !systemTexts.isEmpty { body["instructions"] = systemTexts.joined(separator: "\n") }
  body["input"] = input
  if let wireTools = openAIResponsesTools(tools) { body["tools"] = wireTools }
  if !outputs.isEmpty {
    body["text"] = ["format": ["type": "json_schema", "name": "structured_output", "schema": buildOutputSchema(outputs), "strict": true]]
  }
  return body
}

private func openAIResponsesTools(_ tools: [[String: Any]]) -> [[String: Any]]? {
  guard !tools.isEmpty else { return nil }
  return tools.map { tool in
    let strict = tool["strict"] as? Bool ?? false
    var out: [String: Any] = [
      "type": "function",
      "name": tool["name"] ?? "",
      "parameters": buildToolParamsSchema(tool["parameters"] as? [[String: Any]] ?? [], strict, tool["bindings"] as? [String: Any]),
    ]
    if let desc = tool["description"] { out["description"] = desc }
    if strict { out["strict"] = true }
    return out
  }
}

private func buildOpenAIEmbeddingWire(_ modelID: String, _ messages: [[String: Any]]) -> [String: Any] {
  let texts = messages.map { partsText($0["content"] as? [[String: Any]] ?? []) }
  return ["model": modelID, "input": texts.count == 1 ? texts[0] : texts]
}

private func buildOpenAIImageWire(_ modelID: String, _ messages: [[String: Any]]) -> [String: Any] {
  ["model": modelID, "prompt": messages.last.map { partsText($0["content"] as? [[String: Any]] ?? []) } ?? ""]
}

private func buildAnthropicWire(_ modelID: String, _ messages: [[String: Any]], _ tools: [[String: Any]], _ options: [String: Any]) -> [String: Any] {
  var body: [String: Any] = ["model": modelID]
  var systemTexts: [String] = []
  var msgs: [[String: Any]] = []
  for msg in messages {
    let role = msg["role"] as? String ?? ""
    let parts = msg["content"] as? [[String: Any]] ?? []
    if role == "system" || role == "developer" {
      systemTexts.append(partsText(parts))
    } else {
      msgs.append(["role": role, "content": anthropicContent(parts)])
    }
  }
  if !systemTexts.isEmpty { body["system"] = systemTexts.joined(separator: "\n") }
  body["messages"] = msgs
  if let wireTools = anthropicTools(tools) { body["tools"] = wireTools }
  if let opts = try? ModelOptions.load(options) {
    for (key, value) in (try? opts.toWire("anthropic")) ?? [:] { body[key] = value }
  }
  if body["max_tokens"] == nil { body["max_tokens"] = 4096 }
  return body
}

private func anthropicContent(_ parts: [[String: Any]]) -> [[String: Any]] {
  parts.compactMap { part in
    switch part["kind"] as? String {
    case "text": return ["type": "text", "text": part["value"] ?? ""]
    case "image": return ["type": "image", "source": ["type": "base64", "media_type": part["mediaType"] ?? "", "data": partValue(part)]]
    default: return nil
    }
  }
}

private func anthropicTools(_ tools: [[String: Any]]) -> [[String: Any]]? {
  guard !tools.isEmpty else { return nil }
  return tools.map { tool in
    var out: [String: Any] = [
      "name": tool["name"] ?? "",
      "input_schema": buildToolParamsSchema(tool["parameters"] as? [[String: Any]] ?? [], false, tool["bindings"] as? [String: Any]),
    ]
    if let desc = tool["description"] { out["description"] = desc }
    return out
  }
}

private func buildToolParamsSchema(_ params: [[String: Any]], _ strict: Bool, _ bindings: [String: Any]?) -> [String: Any] {
  var props: [String: Any] = [:]
  var required: [String] = []
  for param in params {
    let name = param["name"] as? String ?? ""
    guard bindings?[name] == nil else { continue }
    props[name] = toolProp(param)
    if param["required"] as? Bool == true { required.append(name) }
  }
  var schema: [String: Any] = ["type": "object", "properties": props]
  if !required.isEmpty { schema["required"] = required }
  if strict { schema["additionalProperties"] = false }
  return schema
}

private func toolProp(_ prop: [String: Any]) -> [String: Any] {
  let kind = prop["kind"] as? String ?? ""
  var schema: [String: Any] = ["type": jsonSchemaType(kind)]
  if kind == "array", let items = prop["items"] as? [String: Any] {
    schema["items"] = ["type": jsonSchemaType(items["kind"] as? String ?? "")]
  }
  return schema
}

private func buildOutputSchema(_ outputs: [[String: Any]]) -> [String: Any] {
  var props: [String: Any] = [:]
  var required: [String] = []
  for output in outputs {
    let name = output["name"] as? String ?? ""
    props[name] = outputProp(output)
    required.append(name)
  }
  return ["type": "object", "properties": props, "required": required, "additionalProperties": false]
}

private func outputProp(_ prop: [String: Any]) -> [String: Any] {
  let kind = prop["kind"] as? String ?? ""
  let required = prop["required"] as? Bool ?? false
  var schema: [String: Any] = [:]
  switch kind {
  case "object":
    let nested = prop["properties"] as? [[String: Any]] ?? []
    var nestedProps: [String: Any] = [:]
    var nestedReq: [String] = []
    for item in nested {
      let name = item["name"] as? String ?? ""
      nestedProps[name] = outputProp(item)
      nestedReq.append(name)
    }
    schema["type"] = nullableType("object", required)
    schema["properties"] = nestedProps
    schema["required"] = nestedReq
    schema["additionalProperties"] = false
  case "array":
    schema["type"] = nullableType("array", required)
    if let items = prop["items"] as? [String: Any] {
      schema["items"] = ["type": jsonSchemaType(items["kind"] as? String ?? "")]
    }
  default:
    schema["type"] = nullableType(jsonSchemaType(kind), required)
  }
  return schema
}

private func nullableType(_ type: String, _ required: Bool) -> Any {
  required ? type : [type, "null"]
}

private func jsonSchemaType(_ kind: String) -> String {
  switch kind {
  case "integer": return "integer"
  case "float": return "number"
  case "boolean": return "boolean"
  case "array": return "array"
  case "object": return "object"
  default: return "string"
  }
}

private func applyOpenAIOptions(_ body: inout [String: Any], _ options: [String: Any]) {
  guard !options.isEmpty, let opts = try? ModelOptions.load(options) else { return }
  for (key, value) in (try? opts.toWire("openai")) ?? [:] { body[key] = value }
  for (key, value) in opts.additionalProperties ?? [:] { body[key] = value }
}

private func audioFormat(_ mediaType: String?) -> String {
  let stripped = (mediaType ?? "").replacingOccurrences(of: "audio/", with: "")
  return stripped == "mpeg" ? "mp3" : stripped
}

private func partValue(_ part: [String: Any]) -> Any {
  part["value"] ?? part["source"] ?? ""
}

private func partsText(_ parts: [[String: Any]]) -> String {
  parts.filter { ($0["kind"] as? String) == "text" }.map { $0["value"] as? String ?? "" }.joined()
}

private let frontmatterRegex = try! NSRegularExpression(
  pattern: #"^\s*(?:---|\+\+\+)(.*?)(?:---|\+\+\+)\s*(.+)$"#,
  options: [.dotMatchesLineSeparators])

public func parseFrontmatter(_ contents: String) throws -> [String: Any] {
  let normalized = contents.replacingOccurrences(of: "\r\n", with: "\n")
  let trimmed = normalized.trimmingCharacters(in: CharacterSet(charactersIn: " \t\r\n"))
  if trimmed.hasPrefix("---") || trimmed.hasPrefix("+++") {
    let range = NSRange(normalized.startIndex..<normalized.endIndex, in: normalized)
    if let match = frontmatterRegex.firstMatch(in: normalized, range: range),
      let fmRange = Range(match.range(at: 1), in: normalized),
      let bodyRange = Range(match.range(at: 2), in: normalized)
    {
      var data = try deserializeYAML(String(normalized[fmRange]))
      data["instructions"] = String(normalized[bodyRange])
      return data
    }
  }
  return try deserializeYAML(normalized)
}

private func deserializeYAML(_ text: String) throws -> [String: Any] {
  guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [:] }
  do {
    return (try Yams.load(yaml: text) as? [String: Any]) ?? [:]
  } catch {
    throw PromptyLoadError(kind: "frontmatter", message: "invalid frontmatter: \(error)")
  }
}

public func resolveReferences(_ data: inout [String: Any], parentDir: URL, allowedRoots: [URL]) throws {
  for (key, value) in data {
    if let string = value as? String {
      let (resolved, changed) = try resolveReference(string, key: key, parentDir: parentDir, allowedRoots: allowedRoots)
      if changed {
        data[key] = resolved
        if var nested = resolved as? [String: Any] {
          try resolveReferences(&nested, parentDir: parentDir, allowedRoots: allowedRoots)
          data[key] = nested
        }
      }
    } else if var map = value as? [String: Any] {
      try resolveReferences(&map, parentDir: parentDir, allowedRoots: allowedRoots)
      data[key] = map
    } else if var array = value as? [Any] {
      for index in array.indices {
        if var map = array[index] as? [String: Any] {
          try resolveReferences(&map, parentDir: parentDir, allowedRoots: allowedRoots)
          array[index] = map
        }
      }
      data[key] = array
    }
  }
}

private func resolveReference(_ string: String, key: String, parentDir: URL, allowedRoots: [URL]) throws -> (Any, Bool) {
  guard string.hasPrefix("${"), string.hasSuffix("}") else { return (NSNull(), false) }
  let inner = String(string.dropFirst(2).dropLast())
  guard let colon = inner.firstIndex(of: ":") else { return (NSNull(), false) }
  let protocolName = inner[..<colon].lowercased()
  let remainder = String(inner[inner.index(after: colon)...])
  switch protocolName {
  case "env":
    return (try resolveEnv(remainder), true)
  case "file":
    return (try resolveFile(remainder, parentDir: parentDir, allowedRoots: allowedRoots), true)
  default:
    return (NSNull(), false)
  }
}

private func resolveEnv(_ remainder: String) throws -> Any {
  let parts = remainder.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
  let name = String(parts.first ?? "")
  if promptyEnvironmentOverrides.keys.contains(name) {
    if let override = promptyEnvironmentOverrides[name] ?? nil { return override }
    throw PromptyLoadError(kind: "env", message: "Environment variable '\(name)' not set")
  }
  if let value = ProcessInfo.processInfo.environment[name] { return value }
  if parts.count > 1 { return String(parts[1]) }
  throw PromptyLoadError(kind: "env", message: "Environment variable '\(name)' not set")
}

private func resolveFile(_ relativePath: String, parentDir: URL, allowedRoots: [URL]) throws -> Any {
  let url = relativeFileURL(relativePath, base: parentDir)
  let path = url.path
  guard FileManager.default.fileExists(atPath: path) else {
    throw PromptyLoadError(kind: "file_missing", message: "FileNotFoundError: referenced file '\(relativePath)' not found")
  }
  let canonical = canonicalURL(url)
  guard allowedRoots.contains(where: { isWithin(canonical, root: $0) }) else {
    throw PromptyLoadError(kind: "file_traversal", message: "File reference '\(relativePath)' resolves outside allowed roots")
  }
  let data = try Data(contentsOf: url)
  let ext = url.pathExtension.lowercased()
  if ext == "json" {
    return try JSONSerialization.jsonObject(with: data)
  }
  if ext == "yaml" || ext == "yml" {
    return try Yams.load(yaml: String(data: data, encoding: .utf8) ?? "") ?? [:]
  }
  return (String(data: data, encoding: .utf8) ?? "").replacingOccurrences(of: "\r\n", with: "\n")
}

private func canonicalURL(_ url: URL) -> URL {
  url.resolvingSymlinksInPath().standardizedFileURL
}

public func relativeFileURL(_ path: String, base: URL) -> URL {
  if path.contains(":") || path.hasPrefix("\\") || path.hasPrefix("/") {
    return URL(fileURLWithPath: path).standardizedFileURL
  }
  var url = base
  for part in path.split(whereSeparator: { $0 == "/" || $0 == "\\" }) {
    url.appendPathComponent(String(part))
  }
  return url.standardizedFileURL
}

private func isWithin(_ url: URL, root: URL) -> Bool {
  let path = canonicalURL(url).path.replacingOccurrences(of: "/", with: "\\").lowercased()
  let rootPath = canonicalURL(root).path.replacingOccurrences(of: "/", with: "\\").lowercased()
  return path == rootPath || path.hasPrefix(rootPath.hasSuffix("\\") ? rootPath : rootPath + "\\")
}

public func buildAgentFromData(_ data: [String: Any]) throws -> Agent {
  if let template = data["template"], !(template is [String: Any]) {
    throw PromptyLoadError(kind: "template", message: "Invalid template format: template must be an object")
  }
  return try Agent.load(data)
}

public func loadPromptyContent(_ contents: String, parentDir: URL, allowedRoots: [URL]) throws -> Agent {
  var data = try parseFrontmatter(contents)
  try resolveReferences(&data, parentDir: parentDir, allowedRoots: allowedRoots)
  return try buildAgentFromData(data)
}

public func loadPromptyFile(_ path: URL) throws -> Agent {
  guard FileManager.default.fileExists(atPath: path.path) else {
    throw PromptyLoadError(kind: "not_found", message: "FileNotFoundError: prompty file not found: '\(path.path)'")
  }
  let text = (try String(contentsOf: path, encoding: .utf8)).replacingOccurrences(of: "\r\n", with: "\n")
  let dir = canonicalURL(path.deletingLastPathComponent())
  return try loadPromptyContent(text, parentDir: dir, allowedRoots: [dir])
}

public func validateInputs(agent: Agent, provided: [String: Any]) throws -> [String: Any] {
  var result = provided
  let context = SaveContext(collectionFormat: "object", useShorthand: false)
  for property in agent.inputs ?? [] {
    let saved = try property.save(context)
    let name = saved["name"] as? String ?? ""
    guard !name.isEmpty, result[name] == nil else { continue }
    if let value = saved["default"], !(value is NSNull) {
      result[name] = value
    } else if saved["required"] as? Bool == true {
      throw PromptyLoadError(kind: "required_input", field: name, message: "Missing required input: \(name)")
    }
  }
  return result
}

private func jsonString(_ value: Any) throws -> String {
  let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  return String(data: data, encoding: .utf8) ?? "{}"
}

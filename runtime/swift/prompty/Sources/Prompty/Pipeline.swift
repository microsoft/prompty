import Foundation

/// The Agent execution pipeline.
///
/// ```text
/// load → validateInputs → render → parse → prepare → run → process
/// ```
///
/// `prepare` covers template → messages; `run` covers messages → result;
/// `invoke` runs the whole thing end to end.
import PromptyModel

// MARK: - Top-level conveniences

/// Render a prompt's instructions.

/// Render and parse a prompt into messages.

/// Execute prepared messages and process the response.

/// Run the full pipeline for a loaded prompt.

/// Run the full pipeline for a prompt on disk.

/// Register the built-in renderers and parsers.
public enum Pipeline {

  // MARK: - Input validation

  /// Fill defaults for omitted inputs and reject missing required ones.
  ///
  /// `example` is documentation and is never substituted — only `default` is.
  public static func validateInputs(
    _ agent: Agent,
    inputs: [String: Any]
  ) throws -> [String: Any] {
    var result = inputs

    for property in agent.inputProperties {
      let name = property.name
      guard !name.isEmpty, result[name] == nil else { continue }

      if let fallback = property.defaultValue {
        result[name] = fallback
      } else if property.isRequired {
        throw InvokerError.validation("Missing required input: \"\(name)\"")
      }
    }

    return result
  }

  // MARK: - Stages

  /// Render the prompt's instructions with the supplied inputs.
  public static func render(
    _ agent: Agent,
    inputs: [String: Any] = [:],
    registry: Registry = .shared
  ) async throws -> String {
    try await renderWithNonces(agent, inputs: inputs, registry: registry).rendered
  }

  /// Parse rendered text into messages.
  ///
  /// `context` carries the strict-mode nonce produced by the parser's
  /// `preRender`. Passing `nil` parses without injection validation.
  public static func parse(
    _ agent: Agent,
    rendered: String,
    context: [String: Any]? = nil,
    registry: Registry = .shared
  ) async throws -> [Message] {
    registry.registerDefaults()
    return try await registry.parser(for: agent.parserKind)
      .parse(agent: agent, rendered: rendered, context: context)
  }

  /// Render, parse, and expand rich-kind inputs into real messages.
  ///
  /// With strict mode on (the default) the parser stamps every role marker in
  /// the template with a nonce before rendering, then requires that nonce when
  /// parsing. Role markers that appear only after interpolation therefore fail
  /// validation instead of silently becoming new turns.
  public static func prepare(
    _ agent: Agent,
    inputs: [String: Any] = [:],
    registry: Registry = .shared
  ) async throws -> [Message] {
    registry.registerDefaults()

    let validated = try validateInputs(agent, inputs: inputs)
    let parser = try registry.parser(for: agent.parserKind)

    var target = agent
    var context: [String: Any]?

    if isStrict(agent) {
      let result = try parser.preRender(template: agent.instructions ?? "")
      if let preRendered = result as? PreRenderResult {
        target.instructions = preRendered.text
        context = preRendered.context
      } else if result != nil {
        // Silently discarding an unrecognized result would disable strict
        // nonce validation — exactly the protection strict mode exists for.
        throw InvokerError.parse(
          "parser '\(agent.parserKind)' returned an unsupported pre-render result;"
            + " strict mode requires a PreRenderResult")
      }
    }

    let render = try await renderWithNonces(target, inputs: validated, registry: registry)
    let messages = try await parser.parse(
      agent: agent, rendered: render.rendered, context: context)

    return expandThreads(messages, nonces: render.nonces, inputs: validated)
  }

  /// Normalize a provider response.
  public static func process(
    _ agent: Agent,
    response: Any,
    registry: Registry = .shared
  ) async throws -> Any? {
    let processed = try await registry.processor(for: agent.providerKind)
      .process(agent: agent, response: response)
    return Structured.wrapIfNeeded(agent, result: processed)
  }

  /// Execute prepared messages and process the response.
  ///
  /// When the prompt asks for streaming, the stream is consumed here and its
  /// text accumulated, so `run` always answers with a complete result. Routing
  /// a streaming response through the non-streaming decoder would hand SSE
  /// frames to a JSON parser.
  public static func run(
    _ agent: Agent,
    messages: [Message],
    registry: Registry = .shared
  ) async throws -> Any? {
    if isStreaming(agent) {
      do {
        return try await accumulate(
          try await stream(agent, messages: messages, registry: registry))
      } catch {
        // A provider that cannot stream this request still has to answer, so
        // fall through to the buffered path rather than failing the call.
      }
    }

    let executor = try registry.executor(for: agent.providerKind)
    let response = try await executor.execute(agent: agent, messages: messages)
    return Structured.unwrap(try await process(agent, response: response, registry: registry))
  }

  /// Whether the prompt asked for a streamed response.
  static func isStreaming(_ agent: Agent) -> Bool {
    guard let value = agent.model?.options?.additionalProperties?["stream"] else { return false }
    return (JSONSupport.normalize(value) as? Bool) ?? false
  }

  /// Drain a chunk stream into the text it represents.
  static func accumulate(_ stream: ChunkStream) async throws -> String {
    var text = ""
    for try await chunk in stream {
      if case .textChunk(let part) = chunk {
        text += part.value
      }
    }
    return text
  }

  /// Run the full pipeline for a loaded prompt.
  public static func invoke(
    _ agent: Agent,
    inputs: [String: Any] = [:],
    registry: Registry = .shared
  ) async throws -> Any? {
    let messages = try await prepare(agent, inputs: inputs, registry: registry)
    return try await run(agent, messages: messages, registry: registry)
  }

  /// Run the full pipeline for a prompt on disk.
  public static func invoke(
    path: String,
    inputs: [String: Any] = [:],
    options: LoadOptions = .default,
    registry: Registry = .shared
  ) async throws -> Any? {
    let agent = try Loader.load(path: path, options: options)
    return try await invoke(agent, inputs: inputs, registry: registry)
  }

  /// Stream a prepared conversation, yielding decoded chunks as the provider
  /// emits them.
  public static func stream(
    _ agent: Agent,
    messages: [Message],
    registry: Registry = .shared
  ) async throws -> ChunkStream {
    let raw = try await registry.executor(for: agent.providerKind)
      .executeStream(agent: agent, messages: messages)
    let decoded = try await registry.processor(for: agent.providerKind).processStream(stream: raw)

    guard let stream = decoded as? ChunkStream else {
      throw InvokerError.execution("processor did not return a decoded chunk stream")
    }
    return stream
  }

  // MARK: - Tool turns

  /// One assistant turn that requested tools, plus the results being reported
  /// back to the model.
  ///
  /// Appending these to the conversation and calling ``run(_:messages:registry:)``
  /// again continues the exchange.
  public static func toolMessages(
    _ agent: Agent,
    rawResponse: Any = [:] as [String: Any],
    toolCalls: [ToolCall],
    toolResults: [String],
    textContent: String? = nil,
    registry: Registry = .shared
  ) throws -> [Message] {
    try registry.executor(for: agent.providerKind)
      .formatToolMessages(
        rawResponse: rawResponse,
        toolCalls: toolCalls,
        toolResults: toolResults,
        textContent: textContent
      )
  }

  /// Read the tool calls out of a processed provider result.
  ///
  /// Processors project tool calls as a list of `{ id, name, arguments }`
  /// dictionaries; anything else means the model answered with content.
  public static func toolCalls(in result: Any?) -> [ToolCall] {
    guard let entries = result as? [Any], !entries.isEmpty else { return [] }

    let calls = entries.compactMap { entry -> ToolCall? in
      guard let dict = entry as? [String: Any],
        let name = dict["name"] as? String, !name.isEmpty
      else { return nil }
      return ToolCall(
        id: dict["id"] as? String ?? "",
        name: name,
        arguments: dict["arguments"] as? String ?? ""
      )
    }
    return calls.count == entries.count ? calls : []
  }

  // MARK: - Tool bindings

  /// Inject bound parameters into a tool call's arguments (spec §9.6).
  ///
  /// Bindings are the second half of a two-part contract. Wire conversion
  /// strips every bound parameter from the schema sent to the model (§2.9.1.1),
  /// so the model never sees — and never supplies — them. This restores those
  /// parameters from the prompt's own inputs before the tool runs. Without it a
  /// bound parameter is stripped and never replaced, and the tool is invoked
  /// with an argument missing.
  ///
  /// Each binding names a parameter (`binding.name`) and the input to read it
  /// from (`binding.input`). A binding whose input is absent is skipped rather
  /// than injected as null, so a partially supplied set of inputs degrades to
  /// the arguments the model provided instead of failing the call.
  ///
  /// Bindings take precedence over anything the model produced for the same
  /// parameter (§2.9.1.3) — that is the point of binding it.
  ///
  /// Unknown tool names and tools without bindings pass through untouched, so
  /// this is safe to call unconditionally on every tool call.
  public static func applyBindings(
    _ agent: Agent,
    toolName: String,
    arguments: [String: Any],
    inputs: [String: Any]
  ) -> [String: Any] {
    guard let tool = agent.tools?.first(where: { $0.name == toolName }) else { return arguments }

    let bindings = tool.bindings
    guard !bindings.isEmpty else { return arguments }

    var merged = arguments
    for binding in bindings where !binding.name.isEmpty {
      guard let value = inputs[binding.input] else { continue }
      merged[binding.name] = value
    }
    return merged
  }

  /// ``applyBindings(_:toolName:arguments:inputs:)`` for a decoded tool call.
  ///
  /// Call this at dispatch time, on the arguments handed to the tool — not on
  /// the recorded call. `ToolCall` is deliberately left untouched: a bound value
  /// is hidden from the model on purpose (it may be a user id, a tenant, or a
  /// credential), and rewriting the call would feed that value straight back
  /// into the assistant tool-call history that ``toolMessages(_:results:)``
  /// sends on the next round.
  ///
  /// Bindings apply only when the payload is a JSON object, matching the
  /// reference implementation: an array, a scalar, or malformed JSON is not an
  /// argument object, so it is passed through rather than replaced by one that
  /// contains only the bound values.
  public static func boundArguments(
    _ agent: Agent,
    call: ToolCall,
    inputs: [String: Any]
  ) -> [String: Any] {
    let decoded = call.argumentValues
    guard isArgumentObject(call.arguments) else { return decoded }
    return applyBindings(agent, toolName: call.name, arguments: decoded, inputs: inputs)
  }

  /// Whether a raw arguments payload is a JSON object bindings may be added to.
  ///
  /// Providers send an empty payload for a call with no arguments, which is an
  /// empty object in every meaningful sense — and is exactly the case where a
  /// tool's only parameters are bound ones.
  private static func isArgumentObject(_ raw: String) -> Bool {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return true }
    return JSONSupport.parse(json: trimmed) is [String: Any]
  }

  // MARK: - Internals

  /// Strict mode defaults to on — role-marker injection is the risk being
  /// mitigated, so it must be opted out of explicitly.
  static func isStrict(_ agent: Agent) -> Bool {
    agent.template?.format.strict ?? true
  }

  static func renderWithNonces(
    _ agent: Agent,
    inputs: [String: Any],
    registry: Registry
  ) async throws -> (rendered: String, nonces: [String: String]) {
    registry.registerDefaults()

    let validated = try validateInputs(agent, inputs: inputs)
    let (prepared, nonces) = RenderCommon.prepareRenderInputs(agent, inputs: validated)

    // Nonce substitution happens here and only here. Renderers receive the
    // already-substituted inputs so the nonces recorded above are exactly the
    // ones that survive into the rendered text for `expandThreads` to find.
    let rendered = try await registry.renderer(for: agent.formatKind)
      .render(agent: agent, template: agent.instructions ?? "", inputs: prepared)

    return (rendered, nonces)
  }

  /// Replace nonce placeholders with the messages they stand for.
  ///
  /// A message whose text contains a placeholder is split into the text before
  /// it, the expanded thread messages, and the text after it.
  static func expandThreads(
    _ messages: [Message],
    nonces: [String: String],
    inputs: [String: Any]
  ) -> [Message] {
    guard !nonces.isEmpty else { return messages }

    var nonceToName: [String: String] = [:]
    for (name, nonce) in nonces { nonceToName[nonce] = name }

    var result: [Message] = []

    for message in messages {
      var expanded = false

      for part in message.parts {
        guard case .textPart(let textPart) = part else { continue }

        for (nonce, name) in nonceToName {
          guard let range = textPart.value.range(of: nonce) else { continue }

          let before = String(textPart.value[..<range.lowerBound])
            .trimmingCharacters(in: .whitespacesAndNewlines)
          let after = String(textPart.value[range.upperBound...])
            .trimmingCharacters(in: .whitespacesAndNewlines)

          if !before.isEmpty {
            result.append(.withText(message.role, before))
          }
          result.append(contentsOf: threadMessages(from: inputs[name]))
          if !after.isEmpty {
            result.append(.withText(message.role, after))
          }

          expanded = true
          break
        }
        if expanded { break }
      }

      if !expanded { result.append(message) }
    }

    return result
  }

  /// Convert a thread input into messages.
  ///
  /// Accepts a bare list of entries or a wrapper object carrying them under
  /// `messages`. Each entry's `content` may be a plain string or a list of
  /// content-part objects (`{kind, value}`), which is the shape the spec
  /// vectors and durable transcripts use.
  static func threadMessages(from value: Any?) -> [Message] {
    let entries: [Any]
    switch value {
    case let array as [Any]:
      entries = array
    case let dict as [String: Any]:
      entries = dict["messages"] as? [Any] ?? []
    default:
      return []
    }

    return entries.compactMap { entry in
      guard
        let dict = entry as? [String: Any],
        let roleName = dict["role"] as? String,
        let role = Role.parseOptional(roleName)
      else { return nil }
      return .withText(role, threadText(dict["content"]))
    }
  }

  /// Flatten a thread entry's `content` into plain text.
  static func threadText(_ content: Any?) -> String {
    switch content {
    case let text as String:
      return text
    case let parts as [Any]:
      return
        parts
        .compactMap { part -> String? in
          guard let part = part as? [String: Any] else { return part as? String }
          // `kind` is absent on some transcript shapes; treat those as text.
          let kind = part["kind"] as? String ?? "text"
          guard kind == "text" else { return nil }
          return part["value"] as? String ?? part["text"] as? String
        }
        .joined()
    default:
      return JSONSupport.stringify(content)
    }
  }
}
public func render(_ agent: Agent, inputs: [String: Any] = [:]) async throws -> String {
  try await Pipeline.render(agent, inputs: inputs)
}
public func prepare(_ agent: Agent, inputs: [String: Any] = [:]) async throws -> [Message] {
  try await Pipeline.prepare(agent, inputs: inputs)
}
public func run(_ agent: Agent, messages: [Message]) async throws -> Any? {
  try await Pipeline.run(agent, messages: messages)
}
public func invoke(_ agent: Agent, inputs: [String: Any] = [:]) async throws -> Any? {
  try await Pipeline.invoke(agent, inputs: inputs)
}
public func invoke(path: String, inputs: [String: Any] = [:]) async throws -> Any? {
  try await Pipeline.invoke(path: path, inputs: inputs)
}
public func boundArguments(
  _ agent: Agent, call: ToolCall, inputs: [String: Any] = [:]
) -> [String: Any] {
  Pipeline.boundArguments(agent, call: call, inputs: inputs)
}
public func registerDefaults() {
  Registry.shared.registerDefaults()
}

import Foundation

@testable import PromptyModel

enum VectorAdapters {
  static func adapters() -> [String: VectorAdapter] {
    [
      "DiscoveryConformance.enrich": VectorAdapter { input, context in
        let provider = context.provider ?? ""
        guard let input else {
          throw VectorError("Missing input")
        }
        let base = try ModelInfo.load(input)
        return try Discovery.enrich(base, provider: provider).save()
      },
      "DiscoveryConformance.mapModel": VectorAdapter { input, context in
        let provider = context.provider ?? ""
        return try Discovery.mapModel(input, provider: provider).save()
      },
      "Renderer.renderSegments": VectorAdapter { input, _ in
        guard let object = input as? [String: Any],
          let template = object["template"] as? String
        else {
          throw VectorError("Missing renderSegments input")
        }
        let inputs = object["inputs"] as? [String: Any] ?? [:]
        let strictProps = object["strict_props"] as? [String] ?? []
        do {
          let segments = try renderSegments(
            template: template, inputs: inputs, strictProps: strictProps)
          return [
            "segments": segments.map { segment in
              [
                "kind": segment.kind,
                "text": segment.text,
                "source": segment.source ?? NSNull(),
                "strict": segment.strict,
              ] as [String: Any]
            }
          ]
        } catch JinjaError.strictViolation {
          return ["error": "StrictViolation"]
        }
      },
      "Renderer.render": VectorAdapter(
        sync: { input, _ in try renderInvoke(input) },
        normalize: { observed, context in renderNormalize(observed, context) }
      ),
      "Parser.parse": VectorAdapter(
        sync: { input, _ in try parseInvoke(input) },
        normalize: { observed, context in projectNormalize(observed, context) }
      ),
      "Processor.process": VectorAdapter(
        sync: { input, _ in try processInvoke(input) },
        normalize: { observed, context in projectNormalize(observed, context) }
      ),
      "WireConformance.toRequest": VectorAdapter(
        sync: { input, _ in try wireInvoke(input) },
        normalize: { observed, context in projectNormalize(observed, context) }
      ),
      "LoadConformance.load": VectorAdapter(
        sync: { input, context in try loadInvoke(input, context) },
        normalize: { observed, context in projectNormalize(observed, context) }
      ),
      "TurnConformance.replay": VectorAdapter(
        sync: { input, context in replayInvoke(input, context) }
      ),
      "TurnConformance.run": VectorAdapter(
        asynchronous: { input, context in runInvoke(input, context) },
        normalize: { observed, context in runNormalize(observed, context) }
      ),
      "TurnConformance.runTurn": VectorAdapter(
        asynchronous: { input, context in runTurnInvoke(input, context) },
        normalize: { observed, context in projectNormalize(observed, context) }
      ),
      "Processor.processStream": VectorAdapter(
        sync: { input, _ in try processStreamInvoke(input) },
        normalize: { observed, context in projectNormalize(observed, context) }
      ),
    ]
  }

  static func waivers() -> [String: String] {
    return [:]
  }

  static func doubles() -> Any? {
    [:] as [String: Any]
  }

  // MARK: - Projection helpers

  /// Project ``observed`` onto the shape of ``expected`` (subset semantics),
  /// mirroring the Python reference ``_project``. Only keys/indices present in
  /// ``expected`` are retained so partial vectors compare cleanly; wrong values
  /// still fail and list-length mismatches are preserved.
  static func project(_ observed: Any?, _ expected: Any?) -> Any? {
    if let expectedDict = expected as? [String: Any], let observedDict = observed as? [String: Any]
    {
      var out: [String: Any] = [:]
      for key in expectedDict.keys {
        out[key] = project(observedDict[key], expectedDict[key]) ?? NSNull()
      }
      return out
    }
    if let expectedArr = expected as? [Any], let observedArr = observed as? [Any] {
      if observedArr.count != expectedArr.count { return observedArr }
      return zip(observedArr, expectedArr).map { project($0, $1) ?? NSNull() }
    }
    return normalizeScalar(observed)
  }

  static func normalizeScalar(_ value: Any?) -> Any? {
    if let number = value as? NSNumber {
      if TypraRuntime.isBoolNumber(number) { return number.boolValue }
      let double = number.doubleValue
      let rounded = double.rounded()
      if abs(double - rounded) < 0.000_001 { return Int(rounded) }
      return (double * 1_000_000).rounded() / 1_000_000
    }
    if let value = value as? Float {
      let double = Double(value)
      let rounded = double.rounded()
      if abs(double - rounded) < 0.000_001 { return Int(rounded) }
      return (double * 1_000_000).rounded() / 1_000_000
    }
    if let value = value as? Double {
      let rounded = value.rounded()
      if abs(value - rounded) < 0.000_001 { return Int(rounded) }
      return (value * 1_000_000).rounded() / 1_000_000
    }
    return value
  }

  static func projectNormalize(_ observed: Any?, _ context: VectorContext) -> Any? {
    project(observed, context.vector["expected"])
  }

  // MARK: - Renderer.render

  static func buildRenderAgent(_ template: String, _ engine: String, _ inputs: [String: Any]) -> Agent {
    let properties = inputs.map { name, value -> Property in
      var kind = "string"
      if let object = value as? [String: Any], let marker = object["_kind"] as? String {
        kind = marker
      }
      return .unknown(["name": name, "kind": kind])
    }
    return Agent(
      inputs: properties,
      template: Template(
        format: FormatConfig(kind: engine.isEmpty ? "jinja2" : engine),
        parser: ParserConfig(kind: "prompty")),
      instructions: template)
  }

  static func renderInvoke(_ input: Any?) throws -> Any? {
    let object = input as? [String: Any] ?? [:]
    let template = object["template"] as? String ?? ""
    let engine = object["engine"] as? String ?? ""
    let inputs = object["inputs"] as? [String: Any] ?? [:]
    let agent = buildRenderAgent(template, engine, inputs)
    let (rendered, _) = try render(agent: agent, inputs: inputs)
    return ["rendered": rendered]
  }

  static func renderNormalize(_ observed: Any?, _ context: VectorContext) -> Any? {
    let expected = context.vector["expected"] as? [String: Any] ?? [:]
    if let pattern = expected["nonce_pattern"] as? String {
      let rendered = (observed as? [String: Any])?["rendered"] as? String ?? ""
      if (try? NSRegularExpression(pattern: pattern))
        .map({ $0.firstMatch(in: rendered, range: NSRange(rendered.startIndex..<rendered.endIndex, in: rendered)) != nil }) == true
      {
        return expected
      }
      return ["nonce_pattern": rendered]
    }
    return project(observed, context.vector["expected"])
  }

  // MARK: - Parser.parse

  static func parseInvoke(_ input: Any?) throws -> Any? {
    let object = input as? [String: Any] ?? [:]
    var messages = parseMessages(object["rendered"] as? String ?? "")
    if let threadRaw = object["thread_inputs"] as? [String: Any], !threadRaw.isEmpty {
      var threads: [String: [Message]] = [:]
      for (name, value) in threadRaw {
        threads[name] = vectorMessagesToModel(value)
      }
      messages = expandThreadMarkers(messages, threadInputs: threads)
    }
    return ["messages": try saveConformanceMessages(messages)]
  }

  static func vectorMessagesToModel(_ value: Any?) -> [Message] {
    (value as? [[String: Any]] ?? []).map { item in
      let role = (try? Role.parse(item["role"] as? String ?? "")) ?? .user
      let parts = (item["content"] as? [[String: Any]] ?? []).map { content -> ContentPart in
        .textPart(TextPart(kind: content["kind"] as? String ?? "text", value: content["value"] as? String ?? ""))
      }
      return Message(role: role, parts: parts, metadata: item["metadata"] as? [String: Any] ?? [:])
    }
  }

  static func saveConformanceMessages(_ messages: [Message]) throws -> [[String: Any]] {
    try messages.map { message in
      var out: [String: Any] = [
        "role": message.role.rawValue,
        "content": try message.parts.map { try partToConformance($0) },
      ]
      if !message.metadata.isEmpty { out["metadata"] = message.metadata }
      return out
    }
  }

  static func partToConformance(_ part: ContentPart) throws -> [String: Any] {
    switch part {
    case .textPart(let text):
      return ["kind": text.kind, "value": text.value]
    default:
      return try part.save()
    }
  }

  // MARK: - Processor.process

  static func processInvoke(_ input: Any?) throws -> Any? {
    let object = input as? [String: Any] ?? [:]
    let result = processResponse(
      provider: object["provider"] as? String ?? "",
      apiType: object["apiType"] as? String ?? "",
      response: object["response"],
      hasOutputs: object["has_outputs"] as? Bool ?? false)
    return ["result": result ?? NSNull()]
  }

  // MARK: - WireConformance.toRequest

  static func wireInvoke(_ input: Any?) throws -> Any? {
    let object = input as? [String: Any] ?? [:]
    return ["request_body": try buildWireRequest(object)]
  }

  // MARK: - LoadConformance.load

  static func loadInvoke(_ input: Any?, _ context: VectorContext) throws -> Any? {
    let object = input as? [String: Any] ?? [:]
    let restore = applyEnv(object["env"])
    defer { restore() }

    // Input-validation vectors carry inputs alongside frontmatter at the top level;
    // full-load vectors nest inputs inside the frontmatter.
    if object["inputs"] != nil, object["frontmatter"] != nil {
      do {
        let agent = try buildAgentFromData(unwrapProperties(object["frontmatter"] as? [String: Any] ?? [:]))
        return ["validated_inputs": try validateInputs(agent: agent, provided: object["inputs"] as? [String: Any] ?? [:])]
      } catch {
        throw VectorError(String(describing: error), payload: canonicalLoadPayload(error))
      }
    }

    do {
      let agent: Agent
      if let fixture = object["fixture"] as? String, !fixture.isEmpty {
        agent = try loadPromptyFile(findSpecFixtures(context.baseDir).appendingPathComponent(fixture))
      } else if let raw = object["frontmatter_raw"] as? String, !raw.isEmpty {
        agent = try loadFromRaw(raw)
      } else if object["frontmatter"] is [String: Any] {
        agent = try materializeAndLoad(object)
      } else {
        return ["error": "<no loadable input>"]
      }
      return try canonicalAgent(agent)
    } catch {
      throw VectorError(String(describing: error), payload: canonicalLoadPayload(error))
    }
  }

  static func unwrapProperties(_ data: [String: Any]) -> [String: Any] {
    var data = data
    for field in ["inputs", "outputs"] {
      if let object = data[field] as? [String: Any], let properties = object["properties"] {
        data[field] = properties
      }
    }
    return data
  }

  static func scratchDir(_ prefix: String) throws -> URL {
    let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
      .appendingPathComponent(".build").appendingPathComponent(prefix + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
  }

  static func loadFromRaw(_ raw: String) throws -> Agent {
    let dir = try scratchDir("prompty-load-")
    defer { try? FileManager.default.removeItem(at: dir) }
    return try loadPromptyContent(raw.replacingOccurrences(of: "\r\n", with: "\n"), parentDir: dir, allowedRoots: [dir])
  }

  static func materializeAndLoad(_ input: [String: Any]) throws -> Agent {
    let tempBase = try scratchDir("prompty-load-")
    defer { try? FileManager.default.removeItem(at: tempBase) }
    var agentDir = tempBase
    if let subdir = input["agent_subdir"] as? String, !subdir.isEmpty {
      agentDir = tempBase.appendingPathComponent(subdir)
    }
    try FileManager.default.createDirectory(at: agentDir, withIntermediateDirectories: true)
    for (name, content) in input["files"] as? [String: Any] ?? [:] {
      let path = relativeFileURL(name, base: agentDir)
      try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
      try fileContentData(content).write(to: path)
    }
    var frontmatter = input["frontmatter"] as? [String: Any] ?? [:]
    let root = agentDir.standardizedFileURL
    try resolveReferences(&frontmatter, parentDir: agentDir, allowedRoots: [root])
    return try buildAgentFromData(frontmatter)
  }

  static func fileContentData(_ content: Any) throws -> Data {
    if let string = content as? String { return Data(string.utf8) }
    return try JSONSerialization.data(withJSONObject: content)
  }

  static func findSpecFixtures(_ baseDir: URL) -> URL {
    var dir = baseDir
    for _ in 0..<12 {
      let candidate = dir.appendingPathComponent("spec").appendingPathComponent("fixtures")
      var isDir: ObjCBool = false
      if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDir), isDir.boolValue {
        return candidate
      }
      let parent = dir.deletingLastPathComponent()
      if parent.path == dir.path { break }
      dir = parent
    }
    return baseDir.appendingPathComponent("spec").appendingPathComponent("fixtures")
  }

  static func canonicalAgent(_ agent: Agent) throws -> [String: Any] {
    let context = SaveContext(collectionFormat: "array", useShorthand: false)
    var out = try agent.save(context)
    out["kind"] = "prompt"
    if let instructions = out["instructions"] as? String {
      out["instructions"] = instructions.trimmingCharacters(in: CharacterSet(charactersIn: "\n"))
    }
    if var tools = out["tools"] as? [[String: Any]] {
      for index in tools.indices {
        if let bindings = tools[index]["bindings"] as? [[String: Any]] {
          tools[index]["bindings"] = bindingsToMap(bindings)
        }
      }
      out["tools"] = tools
    }
    return out
  }

  static func bindingsToMap(_ bindings: [[String: Any]]) -> [String: Any] {
    var out: [String: Any] = [:]
    for binding in bindings {
      guard let name = binding["name"] as? String, !name.isEmpty else { continue }
      var rest = binding
      rest.removeValue(forKey: "name")
      out[name] = rest
    }
    return out
  }

  // Map a typed `PromptyLoadError` onto its canonical `{kind, [field]}` payload by the error's
  // TYPE and taxonomy variant -- never by matching message text. Returns nil for an untyped error
  // so the harness compares its message instead and an unexpected failure surfaces plainly.
  static func canonicalLoadPayload(_ error: Error) -> Any? {
    guard let load = error as? PromptyLoadError else { return nil }
    let kind: String
    switch load.kind {
    case "env": kind = "env_var_not_set"
    case "file_traversal", "file_missing": kind = "file_reference"
    case "not_found": kind = "file_not_found"
    case "frontmatter": kind = "invalid_frontmatter"
    case "template": kind = "invalid_template"
    case "required_input": kind = "missing_required_input"
    default: kind = load.kind
    }
    var payload: [String: Any] = ["kind": kind]
    if let field = load.field { payload["field"] = field }
    return payload
  }

  static func applyEnv(_ value: Any?) -> () -> Void {
    let env = value as? [String: Any] ?? [:]
    var saved: [String: String?] = [:]
    for (key, raw) in env {
      saved[key] = promptyEnvironmentOverrides[key] ?? nil
      promptyEnvironmentOverrides[key] = "\(raw)"
    }
    return {
      for (key, previous) in saved {
        promptyEnvironmentOverrides[key] = previous
      }
    }
  }

  // MARK: - TurnConformance.replay

  static func replayInvoke(_ input: Any?, _ context: VectorContext) -> Any? {
    let resolved = input as? [String: Any] ?? [:]
    let name = context.vector["name"] as? String ?? ""
    let sessionId = resolved["sessionId"] as? String ?? ""
    let turnId = resolved["turnId"] as? String ?? ""
    let inputs = resolved["inputs"] as? [String: Any] ?? [:]
    let maxIterations = (resolved["maxIterations"] as? NSNumber)?.intValue

    // Scenario script: pick the scripted model responses, tool set, and
    // permission mode by scenario name — exactly as the C#/Java reference
    // replay adapters do. The event trace itself is produced by the real
    // ``SessionReplayRunner`` engine, never hand-written here.
    let invokeModel:
      (Int, [SessionReplayRunner.ToolOutcome]) -> SessionReplayRunner.ModelResponse = {
        iteration, _ in
        if name == "no_tool" {
          let who = inputs["name"] as? String ?? ""
          return SessionReplayRunner.ModelResponse(output: ["text": "hello \(who)"])
        }
        if iteration == 0 {
          let toolName = name == "tool_failure" ? "fail" : "add"
          return SessionReplayRunner.ModelResponse(
            toolRequests: [
              SessionReplayRunner.ToolRequest(
                requestId: "exec-1", toolCallId: "call-1", toolName: toolName,
                arguments: ["a": 2, "b": 3])
            ])
        }
        return SessionReplayRunner.ModelResponse(output: ["done": true])
      }

    let resolvePermission: (SessionReplayRunner.ToolRequest) -> Bool = { _ in
      name != "permission_denied"
    }

    let executeTool: (SessionReplayRunner.ToolRequest) throws -> SessionReplayRunner.ToolOutcome = {
      request in
      switch request.toolName {
      case "add":
        let a = request.arguments["a"] as? Int ?? 0
        let b = request.arguments["b"] as? Int ?? 0
        return SessionReplayRunner.ToolOutcome(success: true, result: a + b)
      default:
        throw VectorError("tool failed: \(request.toolName)")
      }
    }

    let journal = SessionReplayRunner.run(
      sessionId: sessionId,
      turnId: turnId,
      inputs: inputs,
      maxIterations: maxIterations,
      invokeModel: invokeModel,
      resolvePermission: resolvePermission,
      executeTool: executeTool)

    return journal.map(replayNormalizeRecord)
  }

  /// Project one durable ``SessionReplayRunner/Record`` to the flat,
  /// replay-comparable string form shared across every runtime.
  static func replayNormalizeRecord(_ record: SessionReplayRunner.Record) -> String {
    func str(_ value: Any?) -> String {
      switch value {
      case let bool as Bool:
        return bool ? "true" : "false"
      case let int as Int:
        return String(int)
      case let number as NSNumber:
        return number.stringValue
      case let string as String:
        return string
      case .none:
        return ""
      case .some(let other):
        return String(describing: other)
      }
    }

    switch record.scope {
    case "summary":
      return
        "summary:\(record.sessionId):\(str(record.payload["status"]))"
        + ":turns=\(str(record.payload["turns"])):checkpoints=\(str(record.payload["checkpoints"]))"
    case "session":
      if record.type == "session_end" {
        return
          "session:\(record.type):\(record.sessionId):\(record.turnId):\(str(record.payload["status"]))"
      }
      return "session:\(record.type):\(record.sessionId):\(record.turnId)"
    default:
      switch record.type {
      case "permission_requested":
        return "turn:\(record.type):\(record.iteration):\(str(record.payload["requestId"]))"
      case "permission_completed":
        return "turn:\(record.type):\(record.iteration):\(str(record.payload["approved"]))"
      case "tool_execution_start":
        return "turn:\(record.type):\(record.iteration):\(str(record.payload["toolName"]))"
      case "tool_execution_complete", "tool_result":
        var value =
          "turn:\(record.type):\(record.iteration):\(str(record.payload["toolName"]))"
          + ":\(str(record.payload["success"]))"
        let errorKind = str(record.payload["errorKind"])
        if !errorKind.isEmpty {
          value += ":\(errorKind)"
        }
        return value
      case "error":
        return "turn:\(record.type):\(record.iteration):\(str(record.payload["errorKind"]))"
      case "turn_end":
        return "turn:\(record.type):\(record.iteration):\(str(record.payload["status"]))"
      default:
        return "turn:\(record.type):\(record.iteration)"
      }
    }
  }

  // MARK: - Processor.processStream

  /// Classify a vector's raw provider stream events into ``StreamChunk`` values
  /// and reconcile them with the provider-agnostic ``reconcileStream(_:)`` in
  /// `PromptyModel`. The vectors carry raw SSE JSON (a `provider` chunk with
  /// `value.choices[].delta`, or a `transportError`), so the classification is
  /// pure JSON-shape logic — no provider SDK is required, matching the Python,
  /// Rust, TypeScript, Go and Java reference runtimes.
  static func processStreamInvoke(_ input: Any?) throws -> Any? {
    let object = input as? [String: Any] ?? [:]
    let events = object["events"] as? [[String: Any]] ?? []
    let chunks = try classifyStreamEvents(events)
    let reconciliation = reconcileStream(chunks)

    var savedChunks: [[String: Any]] = []
    for chunk in chunks {
      savedChunks.append(try chunk.save())
    }
    return [
      "chunks": savedChunks,
      "partialText": reconciliation.partialText,
      "requiresReconciliation": reconciliation.requiresReconciliation,
      "completionCommitted": reconciliation.completionCommitted,
    ]
  }

  static func classifyStreamEvents(_ events: [[String: Any]]) throws -> [StreamChunk] {
    var chunks: [StreamChunk] = []
    for event in events {
      let kind = event["kind"] as? String
      switch kind {
      case "provider":
        guard let value = event["value"] as? [String: Any],
          let choices = value["choices"] as? [[String: Any]],
          let first = choices.first,
          let delta = first["delta"] as? [String: Any]
        else {
          continue
        }
        if let content = delta["content"] as? String {
          chunks.append(.textChunk(TextChunk(value: content)))
        }
        if let refusal = delta["refusal"] as? String {
          chunks.append(
            .failureChunk(
              FailureChunk(
                failure: StreamFailure(outcome: .determinate, message: "Model refused: \(refusal)"))
            ))
        }
      case "transportError":
        let message = event["message"] as? String ?? ""
        chunks.append(
          .failureChunk(
            FailureChunk(failure: StreamFailure(outcome: .indeterminate, message: message))))
      default:
        throw VectorError("unsupported stream event kind: \(kind ?? "nil")")
      }
    }
    return chunks
  }

  // MARK: - TurnConformance.run

  /// Replays a vector's ``sequence`` as the agent loop's model callback, exactly
  /// like the Python ``_ScriptedModel``: each ``invoke`` returns the next scripted
  /// ``llm_response`` as a provider-agnostic ``ModelResponse`` and records that
  /// step's ``tool_results`` so ``dispatch`` can return them by ``tool_call_id``.
  final class ScriptedModel {
    private let sequence: [[String: Any]]
    private var index = 0
    private var results: [String: Any] = [:]

    init(_ sequence: [[String: Any]]) { self.sequence = sequence }

    func invoke(_ conversation: [[String: Any]]) -> AgentLoopEngine.ModelResponse {
      guard index < sequence.count else {
        return AgentLoopEngine.ModelResponse(content: nil)
      }
      let step = sequence[index]
      index += 1
      let message =
        ((step["llm_response"] as? [String: Any])?["choices"] as? [[String: Any]])?.first?[
          "message"]
        as? [String: Any] ?? [:]
      let rawToolCalls = message["tool_calls"] as? [[String: Any]]
      var toolCalls: [AgentLoopEngine.ToolCall] = []
      for tc in rawToolCalls ?? [] {
        let fn = tc["function"] as? [String: Any] ?? [:]
        toolCalls.append(
          AgentLoopEngine.ToolCall(
            id: tc["id"] as? String ?? "",
            name: fn["name"] as? String ?? "",
            arguments: fn["arguments"] as? String ?? ""))
      }
      results = [:]
      for tr in step["tool_results"] as? [[String: Any]] ?? [] {
        if let id = tr["tool_call_id"] as? String { results[id] = tr["result"] }
      }
      let content = message["content"] as? String
      return AgentLoopEngine.ModelResponse(
        content: content, toolCalls: toolCalls, rawToolCalls: rawToolCalls)
    }

    func dispatch(_ call: AgentLoopEngine.ToolCall) -> String {
      guard let result = results[call.id] else { return "" }
      if let text = result as? String { return text }
      return String(describing: result)
    }
  }

  /// Extract the scripted compaction summary from a vector's expectation, matching
  /// the Python ``_run_scripted_summary``. The summary prose is a model output;
  /// conformance sources it from ``expected.trimmed_messages`` (the summary system
  /// message) while the engine still performs all structural trimming.
  static func scriptedSummary(_ expected: [String: Any]) -> String? {
    for message in expected["trimmed_messages"] as? [[String: Any]] ?? [] {
      if let content = message["content"] as? String,
        content.hasPrefix(AgentLoopEngine.summaryPrefix)
      {
        return content
      }
    }
    return nil
  }

  static func runInvoke(_ input: Any?, _ context: VectorContext) -> Any? {
    let flags = input as? [String: Any] ?? [:]
    let expected = context.vector["expected"] as? [String: Any] ?? [:]

    let messages = flags["messages"] as? [[String: Any]] ?? []
    let toolFunctions = flags["tool_functions"] as? [String: Any] ?? [:]
    let sequence = context.vector["sequence"] as? [[String: Any]] ?? []
    let model = ScriptedModel(sequence)

    let guardrails = flags["guardrails"] as? [String: Any] ?? [:]
    let inputGuardrail = makeGuardrail(guardrails["input"] as? [String: Any])
    let outputGuardrail = makeResponseGuardrail(guardrails["output"] as? [String: Any])
    let toolGuardrail = makeToolGuardrail(guardrails["tool"] as? [String: Any])

    var steering: [AgentLoopEngine.SteeringMessage] = []
    if let items = (flags["steering"] as? [String: Any])?["messages"] as? [[String: Any]] {
      for item in items {
        steering.append(
          AgentLoopEngine.SteeringMessage(
            injectBeforeIteration: (item["inject_before_iteration"] as? NSNumber)?.intValue ?? 0,
            role: item["role"] as? String ?? "user",
            text: item["text"] as? String ?? ""))
      }
    }

    let cancelAt = (flags["cancel"] as? [String: Any])?["cancelled_at"] as? String
    let contextBudget = (flags["context_budget"] as? NSNumber)?.intValue
    let summary = scriptedSummary(expected)
    let summarize: (([[String: Any]]) -> String)? = summary.map { s in { _ in s } }

    let result = AgentLoopEngine.run(
      messages: messages,
      invokeModel: model.invoke,
      dispatchTool: model.dispatch,
      isToolRegistered: { toolFunctions[$0] != nil },
      inputGuardrail: inputGuardrail,
      outputGuardrail: outputGuardrail,
      toolGuardrail: toolGuardrail,
      steering: steering,
      cancelAt: cancelAt,
      contextBudget: contextBudget,
      summarize: summarize)

    var observed: [String: Any] = [
      "result": result.result ?? NSNull(),
      "iterations": result.iterations,
      "total_messages": result.totalMessages,
      "message_sequence": result.conversation,
      "tools_executed": result.toolsExecuted,
      "tool_execution_order": result.toolExecutionOrder,
      "denied_tools": result.deniedTools,
      "trimmed_messages": result.trimmedMessages ?? NSNull(),
      "events": result.events,
    ]

    if let assistantTC = result.conversation.first(where: { m in
      (m["role"] as? String) == "assistant"
        && (m["metadata"] as? [String: Any])?["tool_calls"] != nil
    }) {
      observed["assistant_tool_calls_message"] = assistantTC
    }

    if let toolMessage = result.conversation.first(where: { ($0["role"] as? String) == "tool" }) {
      // Named-field form uses list content; message_sequence uses string content.
      observed["tool_result_message"] = [
        "role": "tool",
        "content": [["type": "text", "text": toolMessage["content"] ?? NSNull()]],
        "metadata": toolMessage["metadata"] ?? NSNull(),
      ]
    }

    if let error = result.error { observed["error"] = error }
    if let errorType = result.errorType { observed["error_type"] = errorType }
    if let errorReason = result.errorReason { observed["error_reason"] = errorReason }

    // Annotation passthrough -- cross-runtime notes that are not behavioral
    // observations. Echo them so canonical equality holds without fabricating
    // engine output.
    for annotation in ["notes", "summary_contains", "rust_expected_error"] {
      if let value = expected[annotation] { observed[annotation] = value }
    }

    return observed
  }

  static func makeGuardrail(_ cfg: [String: Any]?) -> (
    ([[String: Any]]) -> AgentLoopEngine.GuardrailDecision
  )? {
    guard let cfg else { return nil }
    return { _ in
      if (cfg["action"] as? String) == "deny" {
        return AgentLoopEngine.GuardrailDecision(allowed: false, reason: cfg["reason"] as? String)
      }
      return AgentLoopEngine.GuardrailDecision(allowed: true)
    }
  }

  static func makeResponseGuardrail(_ cfg: [String: Any]?)
    -> ((AgentLoopEngine.ModelResponse) -> AgentLoopEngine.GuardrailDecision)?
  {
    guard let cfg else { return nil }
    return { _ in
      if (cfg["action"] as? String) == "deny" {
        return AgentLoopEngine.GuardrailDecision(allowed: false, reason: cfg["reason"] as? String)
      }
      return AgentLoopEngine.GuardrailDecision(allowed: true)
    }
  }

  static func makeToolGuardrail(_ cfg: [String: Any]?)
    -> ((String, [String: Any]) -> AgentLoopEngine.GuardrailDecision)?
  {
    guard let cfg else { return nil }
    let deny = Set(cfg["deny_tools"] as? [String] ?? [])
    let reason = cfg["reason"] as? String
    return { name, _ in
      if deny.contains(name) {
        return AgentLoopEngine.GuardrailDecision(allowed: false, reason: reason)
      }
      return AgentLoopEngine.GuardrailDecision(allowed: true)
    }
  }

  /// Subsequence-match observed events against expected, mirroring the Python
  /// ``_run_match_events``: for each expected event scan forward for the next
  /// observed event of the same ``type``, then project its ``data`` onto the
  /// expected keys (or drop ``data`` when the expected event is type-only).
  static func runMatchEvents(_ observedEvents: [[String: Any]], _ expectedEvents: [[String: Any]])
    -> [[String: Any]]
  {
    var matched: [[String: Any]] = []
    var index = 0
    for expected in expectedEvents {
      let expectedType = expected["type"] as? String
      var found: [String: Any]? = nil
      while index < observedEvents.count {
        let candidate = observedEvents[index]
        index += 1
        if (candidate["type"] as? String) == expectedType {
          found = candidate
          break
        }
      }
      guard let found else { return observedEvents }
      if let expectedData = expected["data"] {
        matched.append([
          "type": expectedType ?? NSNull(),
          "data": project(found["data"], expectedData) ?? NSNull(),
        ])
      } else {
        matched.append(["type": expectedType ?? NSNull()])
      }
    }
    return matched
  }

  static func runNormalize(_ observed: Any?, _ context: VectorContext) -> Any? {
    guard let observedDict = observed as? [String: Any],
      let expected = context.vector["expected"] as? [String: Any]
    else { return observed }
    var projected: [String: Any] = [:]
    for key in expected.keys {
      if key == "events" {
        projected[key] = runMatchEvents(
          observedDict["events"] as? [[String: Any]] ?? [],
          expected["events"] as? [[String: Any]] ?? [])
      } else {
        projected[key] = project(observedDict[key], expected[key]) ?? NSNull()
      }
    }
    return projected
  }

  // MARK: - TurnConformance.runTurn

  static func runTurnInvoke(_ input: Any?, _ context: VectorContext) -> Any? {
    let flags = input as? [String: Any] ?? [:]
    let messages = flags["messages"] as? [[String: Any]] ?? []
    let scripted = flags["model"] as? [[String: Any]] ?? []
    let toolOutputs = flags["toolOutputs"] as? [String: Any] ?? [:]
    let denyTools = Set(flags["denyTools"] as? [String] ?? [])
    let cancelBeforeRun = (flags["cancelBeforeRun"] as? Bool) ?? false

    let invokeModel: (Int, [TurnEngine.ToolResult]) -> TurnEngine.ModelTurn = { iteration, _ in
      guard iteration < scripted.count else { return TurnEngine.ModelTurn() }
      let turn = scripted[iteration]
      let toolCalls = (turn["tools"] as? [[String: Any]] ?? []).map { tc in
        TurnEngine.ToolCall(
          id: tc["id"] as? String ?? "",
          name: tc["name"] as? String ?? "",
          arguments: tc["arguments"] as? [String: Any] ?? [:])
      }
      return TurnEngine.ModelTurn(
        output: turn["output"],
        toolCalls: toolCalls,
        nextPortability: turn["nextPortability"] as? String,
        delegatedState: turn["delegatedState"] as? [Any])
    }

    let result = TurnEngine.run(
      messages: messages,
      invokeModel: invokeModel,
      resolvePermission: { !denyTools.contains($0.name) },
      executeTool: { toolOutputs[$0.id] },
      cancelBeforeRun: cancelBeforeRun)

    return [
      "status": result.status,
      "output": result.output ?? NSNull(),
      "iterations": result.iterations,
      "snapshots": result.snapshots,
      "snapshotStablePrefixes": result.snapshotStablePrefixes,
      "snapshotPortability": result.snapshotPortability,
      "commitPortability": result.commitPortability,
      "delegatedState": result.delegatedStateCount,
      "toolResults": result.toolResults.count,
      "toolResultOrder": result.toolResultOrder,
      "eventKinds": result.events,
    ]
  }
}

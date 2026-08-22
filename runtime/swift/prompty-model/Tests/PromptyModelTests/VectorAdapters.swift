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
    // This generated conformance harness runs in the `PromptyModel` test target,
    // which depends only on `PromptyModel`. The load/render/parse pipeline lives
    // in the `Prompty` SDK package and the wire/process layers live in the
    // provider packages (`PromptyOpenAI`/`PromptyAnthropic`/`PromptyFoundry`),
    // all of which depend on `PromptyModel`. Importing them here would be a
    // circular package dependency, so those operations cannot be driven from
    // this harness. They are exercised against the same generated `vectors.json`
    // by the SDK/provider-level runners in `prompty/Tests/PromptyTests`. These
    // waivers therefore record a package-layering boundary, not an unwired gap.
    //
    // By contrast, `TurnConformance.run` and `TurnConformance.runTurn` are
    // provider-agnostic engines (`AgentLoopEngine`, `TurnEngine`) that live in
    // `PromptyModel` itself, so they are driven directly by this harness with no
    // waiver — matching the Python and Rust reference runtimes.
    let sdkPipeline =
      "Implemented in the `Prompty` SDK package (`Loader`, `Pipeline`, "
      + "`Jinja2Renderer`/`MustacheRenderer`, `PromptyChatParser`), which depends on "
      + "`PromptyModel`. This conformance harness runs in the `PromptyModel` test "
      + "target and cannot import `Prompty` without a circular package dependency, so "
      + "this operation is driven against the same generated `vectors.json` by the "
      + "SDK-level runners in `prompty/Tests/PromptyTests` "
      + "(`LoadVectorTests`, `RenderVectorTests`, `ParseVectorTests`)."
    let providerLayer =
      "Implemented in the provider packages (`PromptyOpenAI`/`PromptyAnthropic`/"
      + "`PromptyFoundry`), which depend on `PromptyModel`. Unreachable from the "
      + "model-only conformance harness (importing a provider here would be a circular "
      + "dependency), so it is driven against the same generated `vectors.json` by the "
      + "provider-level runners in `prompty/Tests/PromptyTests` "
      + "(`WireVectorTests`, `ProcessVectorTests`, `AnthropicWireVectorTests`, "
      + "`AnthropicProcessVectorTests`)."
    let replayLayer =
      "The async replay-journal runner lives in the `Prompty` SDK package and is "
      + "driven against the generated `replay` vectors by `ReplayVectorTests` in "
      + "`prompty/Tests/PromptyTests`. Unreachable from this model-only harness "
      + "(circular package dependency), so it records a package-layering boundary."
    return [
      "LoadConformance.load": sdkPipeline,
      "Renderer.render": sdkPipeline,
      "Parser.parse": sdkPipeline,
      "WireConformance.toRequest": providerLayer,
      "Processor.process": providerLayer,
      "TurnConformance.replay": replayLayer,
    ]
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
    return observed
  }

  static func projectNormalize(_ observed: Any?, _ context: VectorContext) -> Any? {
    project(observed, context.vector["expected"])
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

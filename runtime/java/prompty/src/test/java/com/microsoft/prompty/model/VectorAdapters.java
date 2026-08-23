package com.microsoft.prompty.model;

import com.microsoft.prompty.CancellationToken;
import com.microsoft.prompty.Messages;
import com.microsoft.prompty.engine.DefaultPorts;
import com.microsoft.prompty.engine.PortException;
import com.microsoft.prompty.engine.Ports;
import com.microsoft.prompty.engine.TurnEngine;
import com.microsoft.prompty.engine.TurnEngineEffects;
import com.microsoft.prompty.engine.TurnEngineRequest;
import com.microsoft.prompty.harness.AllowAllPermissionResolver;
import com.microsoft.prompty.harness.CollectingEventSink;
import com.microsoft.prompty.harness.DenyAllPermissionResolver;
import com.microsoft.prompty.harness.FunctionHostToolExecutor;
import com.microsoft.prompty.harness.InMemoryCheckpointStore;
import com.microsoft.prompty.harness.JsonlEventJournalWriter;
import com.microsoft.prompty.harness.ReferenceTurnRunner;
import com.microsoft.prompty.jinjasubset.JinjaSubsetRenderer;
import com.microsoft.prompty.jinjasubset.Segment;
import com.microsoft.prompty.jinjasubset.StrictViolationException;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Hand-written adapters for the generated vector conformance harness.
 *
 * <p>Each adapter drives real, provider-agnostic Java runtime code against the shared cross-runtime
 * vectors: the streaming reconciliation contract ({@code Processor.processStream}), the agent loop
 * ({@code TurnConformance.run}), the snapshot/portability turn engine ({@code
 * TurnConformance.runTurn}), and the reference replay runner ({@code TurnConformance.replay}). The
 * remaining waivers are covered by dedicated Java driver tests elsewhere in this module.
 */
public final class VectorAdapters {
  private VectorAdapters() {}

  public static Map<String, VectorConformanceTests.VectorAdapter> adapters() {
    Map<String, VectorConformanceTests.VectorAdapter> adapters = new LinkedHashMap<>();
    adapters.put(
        "Renderer.renderSegments", new VectorConformanceTests.VectorAdapter(VectorAdapters::renderSegments));
    adapters.put(
        "Processor.processStream",
        new VectorConformanceTests.VectorAdapter(
            VectorAdapters::processStreamInvoke, VectorAdapters::projectNormalize));
    adapters.put(
        "TurnConformance.run",
        new VectorConformanceTests.VectorAdapter(VectorAdapters::runInvoke, VectorAdapters::runNormalize));
    adapters.put(
        "TurnConformance.runTurn",
        new VectorConformanceTests.VectorAdapter(
            VectorAdapters::runTurnInvoke, VectorAdapters::projectNormalize));
    adapters.put(
        "TurnConformance.replay", new VectorConformanceTests.VectorAdapter(VectorAdapters::replayInvoke));
    return adapters;
  }

  public static Map<String, String> waivers() {
    Map<String, String> waivers = new LinkedHashMap<>();
    waivers.put("DiscoveryConformance.enrich", "Java conformance adapter not implemented in this runtime yet.");
    waivers.put("DiscoveryConformance.mapModel", "Java conformance adapter not implemented in this runtime yet.");
    waivers.put("LoadConformance.load", "Covered by Java LoadVectorsTest; generated adapter not implemented yet.");
    waivers.put("Renderer.render", "Covered by Java RenderVectorsTest; generated adapter not implemented yet.");
    waivers.put("Parser.parse", "Covered by Java ParseVectorsTest; generated adapter not implemented yet.");
    waivers.put("Processor.process", "Java conformance adapter not implemented in this runtime yet.");
    waivers.put("WireConformance.toRequest", "Java conformance adapter not implemented in this runtime yet.");
    return waivers;
  }

  public static Object doubles() {
    return new LinkedHashMap<String, Object>();
  }

  // ---------------------------------------------------------------------------
  // Renderer.renderSegments
  // ---------------------------------------------------------------------------

  @SuppressWarnings("unchecked")
  private static Object renderSegments(Object input, VectorConformanceTests.VectorContext ctx) {
    Map<String, Object> map = input instanceof Map<?, ?> m ? copyMap(m) : new LinkedHashMap<>();
    String template = string(map.get("template"));
    Map<String, Object> inputs = map.get("inputs") instanceof Map<?, ?> m ? copyMap(m) : new LinkedHashMap<>();
    List<String> strictProps = new ArrayList<>();
    if (map.get("strict_props") instanceof Iterable<?> items) {
      for (Object item : items) if (item != null) strictProps.add(String.valueOf(item));
    }

    Map<String, Object> result = new LinkedHashMap<>();
    try {
      List<Object> serialized = new ArrayList<>();
      for (Segment segment : JinjaSubsetRenderer.renderSegments(template, inputs, strictProps)) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kind", segment.kind());
        out.put("text", segment.text());
        out.put("source", segment.source());
        out.put("strict", segment.strict());
        serialized.add(out);
      }
      result.put("segments", serialized);
    } catch (StrictViolationException ex) {
      result.put("error", "StrictViolation");
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Processor.processStream -- provider-agnostic classification + reconciliation
  // ---------------------------------------------------------------------------

  private static Object processStreamInvoke(Object input, VectorConformanceTests.VectorContext ctx) {
    Map<String, Object> map = asMap(input);
    String provider = string(map.get("provider"));
    if (provider.isEmpty()) {
      provider = ctx.provider == null ? "openai" : ctx.provider;
    }
    if (!"openai".equals(provider)) {
      throw new IllegalStateException("unsupported stream provider: " + provider);
    }

    List<StreamChunk> chunks = classifyStreamEvents(asList(map.get("events")));
    List<Object> saved = new ArrayList<>();
    for (StreamChunk chunk : chunks) {
      saved.add(chunk.save(new SaveContext()));
    }

    String partialText = "";
    boolean requiresReconciliation = false;
    int failureCount = 0;
    for (StreamChunk chunk : chunks) {
      if (chunk instanceof TextChunk text) {
        partialText += text.value;
      } else if (chunk instanceof FailureChunk failure) {
        failureCount++;
        if (failure.failure != null && "indeterminate".equals(failure.failure.outcome.value)) {
          requiresReconciliation = true;
        }
      }
    }

    Map<String, Object> out = new LinkedHashMap<>();
    out.put("chunks", saved);
    out.put("partialText", partialText);
    out.put("requiresReconciliation", requiresReconciliation);
    out.put("completionCommitted", failureCount == 0);
    return out;
  }

  private static List<StreamChunk> classifyStreamEvents(List<Object> events) {
    List<StreamChunk> chunks = new ArrayList<>();
    for (Object raw : events) {
      Map<String, Object> event = asMap(raw);
      String kind = string(event.get("kind"));
      switch (kind) {
        case "provider" -> {
          Map<String, Object> value = asMap(event.get("value"));
          List<Object> choices = asList(value.get("choices"));
          if (choices.isEmpty()) {
            continue;
          }
          Map<String, Object> delta = asMap(asMap(choices.get(0)).get("delta"));
          if (delta.get("content") != null) {
            TextChunk text = new TextChunk();
            text.kind = "text";
            text.value = String.valueOf(delta.get("content"));
            chunks.add(text);
          }
          if (delta.get("refusal") != null) {
            chunks.add(failureChunk("determinate", "Model refused: " + String.valueOf(delta.get("refusal"))));
          }
        }
        case "transportError" -> chunks.add(failureChunk("indeterminate", string(event.get("message"))));
        default -> throw new IllegalStateException("unsupported stream event kind: " + kind);
      }
    }
    return chunks;
  }

  private static FailureChunk failureChunk(String outcome, String message) {
    FailureChunk chunk = new FailureChunk();
    chunk.kind = "failure";
    StreamFailure failure = new StreamFailure();
    failure.outcome = StreamFailureOutcome.fromValue(outcome);
    failure.message = message;
    chunk.failure = failure;
    return chunk;
  }

  // ---------------------------------------------------------------------------
  // TurnConformance.run -- provider-agnostic agent loop
  // ---------------------------------------------------------------------------

  private static final int AGENT_DEFAULT_MAX_ITERATIONS = 10;
  private static final String AGENT_SUMMARY_PREFIX = "[Summary of earlier conversation] ";
  private static final String AGENT_CANCELLED_ERROR = "CancelledError";
  private static final String AGENT_GUARDRAIL_ERROR = "GuardrailError";

  /** A single tool invocation requested by the scripted model. */
  private record AgentToolCall(String id, String name, String arguments) {}

  /** A normalized single-turn model response replayed from the vector sequence. */
  private static final class AgentModelResponse {
    Object content;
    List<AgentToolCall> toolCalls = new ArrayList<>();
    List<Object> rawToolCalls;
  }

  /** The observable result of one agent-loop run. */
  private static final class AgentLoopResult {
    Object result;
    int iterations;
    List<Map<String, Object>> conversation = new ArrayList<>();
    List<Map<String, Object>> events = new ArrayList<>();
    int toolRounds;
    int toolsExecuted;
    List<String> toolExecutionOrder = new ArrayList<>();
    List<String> deniedTools = new ArrayList<>();
    List<Map<String, Object>> trimmedMessages;
    Object error;
    Object errorType;
    Object errorReason;

    int totalMessages() {
      return conversation.size() + (toolRounds > 0 ? 1 : 0);
    }
  }

  /** Replays a vector's sequence as the loop's model callback, keyed by tool_call_id. */
  private static final class ScriptedModel {
    private final List<Object> sequence;
    private int index;
    private Map<String, Object> results = new LinkedHashMap<>();

    ScriptedModel(List<Object> sequence) {
      this.sequence = sequence;
    }

    AgentModelResponse invoke() {
      Map<String, Object> step = asMap(sequence.get(index));
      index++;
      Map<String, Object> llm = asMap(step.get("llm_response"));
      List<Object> choices = asList(llm.get("choices"));
      Map<String, Object> message = choices.isEmpty() ? new LinkedHashMap<>() : asMap(asMap(choices.get(0)).get("message"));

      List<Object> rawToolCalls = asList(message.get("tool_calls"));
      AgentModelResponse response = new AgentModelResponse();
      for (Object raw : rawToolCalls) {
        Map<String, Object> tc = asMap(raw);
        Map<String, Object> fn = asMap(tc.get("function"));
        response.toolCalls.add(
            new AgentToolCall(string(tc.get("id")), string(fn.get("name")), string(fn.get("arguments"))));
      }

      results = new LinkedHashMap<>();
      for (Object raw : asList(step.get("tool_results"))) {
        Map<String, Object> tr = asMap(raw);
        results.put(string(tr.get("tool_call_id")), tr.get("result"));
      }

      response.content = message.get("content");
      if (!rawToolCalls.isEmpty()) {
        response.rawToolCalls = rawToolCalls;
      }
      return response;
    }

    String dispatch(AgentToolCall call) {
      Object value = results.get(call.id());
      if (value == null) {
        return "";
      }
      return value instanceof String s ? s : String.valueOf(value);
    }
  }

  private static Object runInvoke(Object input, VectorConformanceTests.VectorContext ctx) {
    Map<String, Object> flags = asMap(input);
    Map<String, Object> vector = asMap(ctx.vector);
    Map<String, Object> expected = asMap(vector.get("expected"));

    List<Map<String, Object>> messages = mapList(flags.get("messages"));
    Map<String, Object> toolFunctions = asMap(flags.get("tool_functions"));
    ScriptedModel model = new ScriptedModel(asList(vector.get("sequence")));

    Integer contextBudget = flags.get("context_budget") == null ? null : intOf(flags.get("context_budget"));
    String cancelAt = string(asMap(flags.get("cancel")).get("cancelled_at"));
    String scriptedSummary = runScriptedSummary(expected);

    AgentLoopResult result =
        runAgentLoop(messages, model, toolFunctions, flags, cancelAt, contextBudget, scriptedSummary);

    Map<String, Object> observed = new LinkedHashMap<>();
    observed.put("result", result.result);
    observed.put("iterations", result.iterations);
    observed.put("total_messages", result.totalMessages());
    observed.put("message_sequence", new ArrayList<Object>(result.conversation));
    observed.put("tools_executed", result.toolsExecuted);
    observed.put("tool_execution_order", new ArrayList<Object>(result.toolExecutionOrder));
    observed.put("denied_tools", new ArrayList<Object>(result.deniedTools));
    observed.put("events", new ArrayList<Object>(result.events));
    observed.put(
        "trimmed_messages", result.trimmedMessages == null ? null : new ArrayList<Object>(result.trimmedMessages));

    Map<String, Object> assistantToolCalls =
        firstMessage(
            result.conversation,
            message ->
                "assistant".equals(message.get("role"))
                    && asMap(message.get("metadata")).containsKey("tool_calls"));
    if (assistantToolCalls != null) {
      observed.put("assistant_tool_calls_message", assistantToolCalls);
    }

    Map<String, Object> toolMessage =
        firstMessage(result.conversation, message -> "tool".equals(message.get("role")));
    if (toolMessage != null) {
      Map<String, Object> textPart = new LinkedHashMap<>();
      textPart.put("type", "text");
      textPart.put("text", toolMessage.get("content"));
      Map<String, Object> wrapped = new LinkedHashMap<>();
      wrapped.put("role", "tool");
      wrapped.put("content", List.of(textPart));
      wrapped.put("metadata", toolMessage.get("metadata"));
      observed.put("tool_result_message", wrapped);
    }

    if (result.error != null) {
      observed.put("error", result.error);
    }
    if (result.errorType != null) {
      observed.put("error_type", result.errorType);
    }
    if (result.errorReason != null) {
      observed.put("error_reason", result.errorReason);
    }

    for (String annotation : List.of("notes", "summary_contains", "rust_expected_error")) {
      if (expected.containsKey(annotation)) {
        observed.put(annotation, expected.get(annotation));
      }
    }
    return observed;
  }

  private static AgentLoopResult runAgentLoop(
      List<Map<String, Object>> messages,
      ScriptedModel model,
      Map<String, Object> toolFunctions,
      Map<String, Object> flags,
      String cancelAt,
      Integer contextBudget,
      String scriptedSummary) {
    int maxIterations = AGENT_DEFAULT_MAX_ITERATIONS;
    AgentLoopResult result = new AgentLoopResult();

    List<Map<String, Object>> conversation = new ArrayList<>();
    for (Map<String, Object> message : messages) {
      conversation.add(copyMap(message));
    }

    emit(result, "status", mapOf("message", "Starting agent loop"));

    List<Map<String, Object>> trimmed = agentMaybeTrim(conversation, contextBudget, scriptedSummary);
    if (trimmed != null) {
      conversation = trimmed;
      result.trimmedMessages = new ArrayList<>();
      for (Map<String, Object> message : trimmed) {
        result.trimmedMessages.add(copyMap(message));
      }
    }

    List<Map<String, Object>> steeringPending = new ArrayList<>(runSteering(flags));
    Map<String, Object> guardrails = asMap(flags.get("guardrails"));

    while (true) {
      int iterationNumber = result.iterations + 1;

      if ("before_iteration".equals(cancelAt) && iterationNumber == 1) {
        emit(result, "cancelled", mapOf("reason", "Cancellation requested before first iteration"));
        result.error = AGENT_CANCELLED_ERROR;
        result.conversation = conversation;
        return result;
      }
      if (("before_iteration_" + iterationNumber).equals(cancelAt)) {
        emit(result, "cancelled", mapOf("reason", "Cancellation requested before iteration " + iterationNumber));
        result.error = AGENT_CANCELLED_ERROR;
        result.conversation = conversation;
        return result;
      }

      List<Map<String, Object>> toInject = new ArrayList<>();
      List<Map<String, Object>> remaining = new ArrayList<>();
      for (Map<String, Object> steer : steeringPending) {
        if (intOf(steer.get("inject_before_iteration")) == iterationNumber) {
          toInject.add(steer);
        } else {
          remaining.add(steer);
        }
      }
      if (!toInject.isEmpty()) {
        steeringPending = remaining;
        emit(result, "status", mapOf("message", "Injecting steering message"));
        for (Map<String, Object> steer : toInject) {
          conversation.add(mapOf("role", string(steer.get("role")), "content", steer.get("text")));
        }
        emit(result, "messages_updated", mapOf("message_count", conversation.size() + 1));
      }

      Map<String, Object> inputGuardrail = asMap(guardrails.get("input"));
      if (!inputGuardrail.isEmpty() && "deny".equals(inputGuardrail.get("action"))) {
        result.error = AGENT_GUARDRAIL_ERROR;
        result.errorReason = inputGuardrail.get("reason");
        result.conversation = conversation;
        return result;
      }

      AgentModelResponse response = model.invoke();
      result.iterations++;

      Map<String, Object> outputGuardrail = asMap(guardrails.get("output"));
      if (!outputGuardrail.isEmpty() && "deny".equals(outputGuardrail.get("action"))) {
        result.error = AGENT_GUARDRAIL_ERROR;
        result.errorReason = outputGuardrail.get("reason");
        result.conversation = conversation;
        return result;
      }

      if (!response.toolCalls.isEmpty()) {
        conversation.add(assistantToolCallsMessage(response));
        result.toolRounds++;
        boolean cancelled = false;
        Map<String, Object> toolGuardrail = asMap(guardrails.get("tool"));
        List<String> denyTools = stringList(toolGuardrail.get("deny_tools"));

        for (int idx = 0; idx < response.toolCalls.size(); idx++) {
          AgentToolCall call = response.toolCalls.get(idx);
          emit(result, "tool_call_start", mapOf("name", call.name(), "arguments", call.arguments()));

          if (!toolGuardrail.isEmpty() && denyTools.contains(call.name())) {
            result.deniedTools.add(call.name());
            conversation.add(
                toolMessage(call.id(), "Tool denied by guardrail: " + string(toolGuardrail.get("reason"))));
            continue;
          }

          if (!toolFunctions.containsKey(call.name())) {
            result.error = "Tool not registered: " + call.name();
            result.errorType = "ValueError";
            result.conversation = conversation;
            return result;
          }

          String output = model.dispatch(call);
          result.toolsExecuted++;
          result.toolExecutionOrder.add(call.name());
          emit(result, "tool_result", mapOf("name", call.name(), "result", output));
          conversation.add(toolMessage(call.id(), output));

          if (("after_tool_" + idx).equals(cancelAt)) {
            emit(result, "cancelled", mapOf("reason", "Cancellation requested after tool execution"));
            result.error = AGENT_CANCELLED_ERROR;
            cancelled = true;
            break;
          }
        }

        if (cancelled) {
          result.conversation = conversation;
          return result;
        }

        emit(result, "messages_updated", mapOf("message_count", conversation.size() + 1));

        if (result.iterations > maxIterations) {
          result.error = "Agent loop exceeded " + maxIterations + " iterations";
          result.conversation = conversation;
          return result;
        }
        continue;
      }

      result.result = response.content;
      conversation.add(mapOf("role", "assistant", "content", response.content));
      emit(result, "done", mapOf("response", response.content));
      result.conversation = conversation;
      return result;
    }
  }

  private static void emit(AgentLoopResult result, String type, Map<String, Object> data) {
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("type", type);
    event.put("data", data);
    result.events.add(event);
  }

  private static Map<String, Object> assistantToolCallsMessage(AgentModelResponse response) {
    List<Object> toolCalls;
    if (response.rawToolCalls != null) {
      toolCalls = response.rawToolCalls;
    } else {
      toolCalls = new ArrayList<>();
      for (AgentToolCall call : response.toolCalls) {
        Map<String, Object> function = new LinkedHashMap<>();
        function.put("name", call.name());
        function.put("arguments", call.arguments());
        Map<String, Object> wrapped = new LinkedHashMap<>();
        wrapped.put("id", call.id());
        wrapped.put("type", "function");
        wrapped.put("function", function);
        toolCalls.add(wrapped);
      }
    }
    Map<String, Object> metadata = new LinkedHashMap<>();
    metadata.put("tool_calls", toolCalls);
    Map<String, Object> message = new LinkedHashMap<>();
    message.put("role", "assistant");
    message.put("content", "");
    message.put("metadata", metadata);
    return message;
  }

  private static Map<String, Object> toolMessage(String callId, String content) {
    Map<String, Object> metadata = new LinkedHashMap<>();
    metadata.put("tool_call_id", callId);
    Map<String, Object> message = new LinkedHashMap<>();
    message.put("role", "tool");
    message.put("content", content);
    message.put("metadata", metadata);
    return message;
  }

  private static List<Map<String, Object>> runSteering(Map<String, Object> flags) {
    Map<String, Object> steeringCfg = asMap(flags.get("steering"));
    List<Map<String, Object>> steering = new ArrayList<>();
    for (Object raw : asList(steeringCfg.get("messages"))) {
      Map<String, Object> item = asMap(raw);
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("inject_before_iteration", intOf(item.get("inject_before_iteration")));
      entry.put("role", item.get("role") == null ? "user" : string(item.get("role")));
      entry.put("text", string(item.get("text")));
      steering.add(entry);
    }
    return steering;
  }

  private static String runScriptedSummary(Map<String, Object> expected) {
    for (Object raw : asList(expected.get("trimmed_messages"))) {
      Map<String, Object> message = asMap(raw);
      if (message.get("content") instanceof String content && content.startsWith(AGENT_SUMMARY_PREFIX)) {
        return content;
      }
    }
    return null;
  }

  private static List<Map<String, Object>> agentMaybeTrim(
      List<Map<String, Object>> conversation, Integer contextBudget, String scriptedSummary) {
    if (contextBudget == null || charCount(conversation) <= contextBudget) {
      return null;
    }

    List<Map<String, Object>> systems = new ArrayList<>();
    List<Map<String, Object>> users = new ArrayList<>();
    for (Map<String, Object> message : conversation) {
      if ("system".equals(message.get("role"))) {
        systems.add(copyMap(message));
      } else if ("user".equals(message.get("role"))) {
        users.add(message);
      }
    }

    List<Map<String, Object>> droppedUsers = new ArrayList<>();
    Map<String, Object> lastUser = null;
    if (!users.isEmpty()) {
      droppedUsers = users.subList(0, users.size() - 1);
      lastUser = users.get(users.size() - 1);
    }

    String summaryText = scriptedSummary != null ? scriptedSummary : agentDefaultSummary(droppedUsers);

    List<Map<String, Object>> trimmed = new ArrayList<>(systems);
    trimmed.add(mapOf("role", "system", "content", summaryText));
    if (lastUser != null) {
      trimmed.add(mapOf("role", "user", "content", lastUser.get("content")));
    }
    return trimmed;
  }

  private static String agentDefaultSummary(List<Map<String, Object>> droppedUsers) {
    List<String> topics = new ArrayList<>();
    for (Map<String, Object> message : droppedUsers) {
      if (message.get("content") instanceof String content && !content.strip().isEmpty()) {
        topics.add(content.strip());
      }
    }
    return AGENT_SUMMARY_PREFIX + "User asked about " + String.join("; ", topics);
  }

  private static int charCount(List<Map<String, Object>> messages) {
    int total = 0;
    for (Map<String, Object> message : messages) {
      if (message.get("content") instanceof String content) {
        total += content.length();
      }
    }
    return total;
  }

  private interface MessagePredicate {
    boolean test(Map<String, Object> message);
  }

  private static Map<String, Object> firstMessage(
      List<Map<String, Object>> conversation, MessagePredicate predicate) {
    for (Map<String, Object> message : conversation) {
      if (predicate.test(message)) {
        return message;
      }
    }
    return null;
  }

  private static Object runNormalize(Object observed, VectorConformanceTests.VectorContext ctx) {
    Map<String, Object> expected = asMap(asMap(ctx.vector).get("expected"));
    if (expected.isEmpty() || !(observed instanceof Map<?, ?>)) {
      return observed;
    }
    Map<String, Object> obs = asMap(observed);
    Map<String, Object> out = new LinkedHashMap<>();
    for (Map.Entry<String, Object> entry : expected.entrySet()) {
      if ("events".equals(entry.getKey())) {
        out.put(entry.getKey(), matchEvents(asList(obs.get("events")), asList(entry.getValue())));
      } else {
        out.put(entry.getKey(), project(obs.get(entry.getKey()), entry.getValue()));
      }
    }
    return out;
  }

  private static Object matchEvents(List<Object> observedEvents, List<Object> expectedEvents) {
    List<Object> matched = new ArrayList<>();
    int index = 0;
    for (Object rawExpected : expectedEvents) {
      Map<String, Object> expected = asMap(rawExpected);
      Object expectedType = expected.get("type");
      Map<String, Object> found = null;
      while (index < observedEvents.size()) {
        Map<String, Object> candidate = asMap(observedEvents.get(index));
        index++;
        if (java.util.Objects.equals(candidate.get("type"), expectedType)) {
          found = candidate;
          break;
        }
      }
      if (found == null) {
        return observedEvents;
      }
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("type", expectedType);
      if (expected.containsKey("data")) {
        entry.put("data", project(found.get("data"), expected.get("data")));
      }
      matched.add(entry);
    }
    return matched;
  }

  // ---------------------------------------------------------------------------
  // TurnConformance.runTurn -- drive the real snapshot/portability turn engine
  // ---------------------------------------------------------------------------

  private static Object runTurnInvoke(Object input, VectorConformanceTests.VectorContext ctx) {
    Map<String, Object> flags = asMap(input);
    String name = string(asMap(ctx.vector).get("name"));

    ScriptedTurnModel model = new ScriptedTurnModel(turnResponses(flags.get("model")));
    RecordingTools tools = new RecordingTools(stringMap(flags.get("toolOutputs")));
    RecordingDurability durability = new RecordingDurability();
    RecordingPostCommit postCommit = new RecordingPostCommit();

    TurnEngineEffects effects =
        TurnEngineEffects.of(model)
            .withPermission(new VectorPermissions(stringList(flags.get("denyTools"))))
            .withTools(tools)
            .withDurability(durability)
            .withPostCommit(postCommit)
            .withClock(() -> "1970-01-01T00:00:00Z")
            .withIds(new DefaultPorts.SequentialIds());

    TurnEngine engine = TurnEngine.of(effects);
    CancellationToken cancellation = CancellationToken.create();
    if (Boolean.TRUE.equals(flags.get("cancelBeforeRun"))) {
      cancellation.cancel();
    }

    TurnEngineResult result =
        engine.run(
            TurnEngineRequest.of("session-" + name, "turn-" + name, turnMessages(flags.get("messages"))),
            cancellation);
    TurnCommit commit = result.commit;

    List<Object> toolResultOrder = new ArrayList<>();
    for (ModelToolResult toolResult : result.toolResults) {
      toolResultOrder.add(toolResult.requestId);
    }
    List<Object> snapshotPortability = new ArrayList<>();
    List<Object> snapshotStablePrefixes = new ArrayList<>();
    for (var snapshot : result.snapshots) {
      snapshotPortability.add(snapshot.contextState.portability.value);
      snapshotStablePrefixes.add(snapshot.stablePrefixMessages);
    }
    List<Object> eventKinds = new ArrayList<>();
    for (EngineEvent event : durability.events) {
      eventKinds.add(event.kind.value);
    }

    Map<String, Object> observed = new LinkedHashMap<>();
    observed.put("status", commit.status.value);
    observed.put("output", commit.output);
    observed.put("iterations", commit.iterations);
    observed.put("snapshots", result.snapshots.size());
    observed.put("snapshotStablePrefixes", snapshotStablePrefixes);
    observed.put("snapshotPortability", snapshotPortability);
    observed.put("toolResults", result.toolResults.size());
    observed.put("toolResultOrder", toolResultOrder);
    observed.put("eventKinds", eventKinds);
    if (commit.contextState != null) {
      observed.put("commitPortability", commit.contextState.portability.value);
      observed.put(
          "delegatedState",
          commit.contextState.delegatedState == null ? 0 : commit.contextState.delegatedState.size());
    }
    return observed;
  }

  private static List<Message> turnMessages(Object value) {
    List<Message> messages = new ArrayList<>();
    for (Object entry : asList(value)) {
      Map<String, Object> map = asMap(entry);
      messages.add(Messages.withText(turnRole(string(map.get("role"))), string(map.get("content"))));
    }
    return messages;
  }

  private static Role turnRole(String role) {
    return switch (role) {
      case "system" -> Role.SYSTEM;
      case "assistant" -> Role.ASSISTANT;
      case "tool" -> Role.TOOL;
      default -> Role.USER;
    };
  }

  private static Deque<ModelInvocationResponse> turnResponses(Object value) {
    Deque<ModelInvocationResponse> responses = new ArrayDeque<>();
    for (Object entry : asList(value)) {
      responses.add(turnResponse(asMap(entry)));
    }
    return responses;
  }

  private static ModelInvocationResponse turnResponse(Map<String, Object> vector) {
    ModelInvocationResponse response = new ModelInvocationResponse();
    response.output = vector.get("output");

    response.assistantMessages = new ArrayList<>();
    if (vector.get("assistant") instanceof String text) {
      response.assistantMessages.add(Messages.assistant(text));
    }

    response.toolRequests = new ArrayList<>();
    for (Object entry : asList(vector.get("tools"))) {
      Map<String, Object> map = asMap(entry);
      ModelToolRequest request = new ModelToolRequest();
      request.id = string(map.get("id"));
      request.name = string(map.get("name"));
      request.arguments = map.get("arguments");
      response.toolRequests.add(request);
    }

    Object portability = vector.get("nextPortability");
    Object delegated = vector.get("delegatedState");
    if (portability != null || delegated != null) {
      InvocationContextState state = new InvocationContextState();
      state.portability =
          portability == null
              ? InvocationContextPortability.PORTABLE
              : InvocationContextPortability.fromValue(string(portability));
      state.delegatedState = new ArrayList<>();
      for (Object entry : asList(delegated)) {
        Map<String, Object> map = asMap(entry);
        DelegatedStateReference reference = new DelegatedStateReference();
        reference.provider = string(map.get("provider"));
        reference.kind = string(map.get("kind"));
        reference.id = string(map.get("id"));
        state.delegatedState.add(reference);
      }
      response.nextContextState = state;
    }
    return response;
  }

  private static final class ScriptedTurnModel implements Ports.ModelPort {
    private final Deque<ModelInvocationResponse> responses;

    ScriptedTurnModel(Deque<ModelInvocationResponse> responses) {
      this.responses = responses;
    }

    @Override
    public ModelInvocationResponse invoke(
        ModelInvocationRequest request, CancellationToken cancellation, Ports.ModelStreamPort stream) {
      ModelInvocationResponse response = responses.poll();
      if (response == null) {
        throw PortException.of("scripted model response exhausted");
      }
      return response;
    }
  }

  private static final class VectorPermissions implements Ports.PermissionPort {
    private final List<String> denied;

    VectorPermissions(List<String> denied) {
      this.denied = denied;
    }

    @Override
    public EnginePermissionDecision authorize(ModelToolRequest request, CancellationToken cancellation) {
      boolean approved = !denied.contains(request.name);
      EnginePermissionDecision decision = new EnginePermissionDecision();
      decision.approved = approved;
      decision.reason = approved ? null : "denied by vector";
      return decision;
    }
  }

  private static final class RecordingTools implements Ports.ToolPort {
    private final Map<String, String> outputs;

    RecordingTools(Map<String, String> outputs) {
      this.outputs = outputs;
    }

    @Override
    public ModelToolResult execute(ModelToolRequest request, CancellationToken cancellation) {
      ModelToolResult result = new ModelToolResult();
      result.requestId = request.id;
      result.name = request.name;
      result.outcome = ModelToolOutcome.SUCCESS;
      result.output =
          outputs.containsKey(request.id) ? outputs.get(request.id) : TypraJson.stringify(request.arguments);
      return result;
    }
  }

  private static final class RecordingDurability implements Ports.DurabilityPort {
    private final List<EngineEvent> events = new ArrayList<>();

    @Override
    public void append(EngineEvent event) {
      events.add(event);
    }

    @Override
    public void appendWithCheckpoint(List<EngineEvent> batch, EngineCheckpoint checkpoint) {
      events.addAll(batch);
    }
  }

  private static final class RecordingPostCommit implements Ports.PostCommitPort {
    private final List<String> effectIds = new ArrayList<>();

    @Override
    public void afterCommit(String effectId, TurnCommit commit, CancellationToken cancellation) {
      effectIds.add(effectId);
    }
  }

  // ---------------------------------------------------------------------------
  // TurnConformance.replay -- drive the reference turn runner + journal normalize
  // ---------------------------------------------------------------------------

  private static Object replayInvoke(Object input, VectorConformanceTests.VectorContext ctx) {
    Map<String, Object> flags = asMap(input);
    String name = string(asMap(ctx.vector).get("name"));
    String clock = string(flags.get("clock"));
    String sessionId = string(flags.get("sessionId"));
    String turnId = string(flags.get("turnId"));

    Path journalPath;
    try {
      journalPath = Files.createTempFile("replay-" + name + "-", ".jsonl");
    } catch (IOException ex) {
      throw new UncheckedIOException(ex);
    }

    try {
      CollectingEventSink sink = new CollectingEventSink();
      JsonlEventJournalWriter journal = new JsonlEventJournalWriter(journalPath);
      InMemoryCheckpointStore checkpoints = new InMemoryCheckpointStore();

      boolean denied = "permission_denied".equals(name);
      PermissionResolver resolver =
          denied ? new DenyAllPermissionResolver() : new AllowAllPermissionResolver();

      FunctionHostToolExecutor tools =
          new FunctionHostToolExecutor()
              .with(
                  "add",
                  (arguments, request) -> {
                    double a = number(arguments.get("a"));
                    double b = number(arguments.get("b"));
                    Map<String, Object> sum = new LinkedHashMap<>();
                    sum.put("sum", a + b);
                    return sum;
                  })
              .with(
                  "fail",
                  (arguments, request) -> {
                    throw new IllegalStateException("tool exploded");
                  });

      ReferenceTurnRunner runner =
          new ReferenceTurnRunner(
              sink,
              journal,
              checkpoints,
              resolver,
              tools,
              request -> replayModelFor(name, request),
              ReferenceTurnRunner.fixedClock(clock),
              ReferenceTurnRunner.sequentialIds());

      RunTurnRequest request = new RunTurnRequest();
      request.sessionId = sessionId;
      request.turnId = turnId;
      Map<String, Object> inputs = asMap(flags.get("inputs"));
      request.inputs = flags.get("inputs") == null ? Map.of() : inputs;

      TurnOptions options = new TurnOptions();
      options.maxIterations = flags.get("maxIterations") == null ? 3 : intOf(flags.get("maxIterations"));
      request.options = options;

      runner.run(request);
      return normalizeJournal(journalPath);
    } finally {
      try {
        Files.deleteIfExists(journalPath);
      } catch (IOException ignored) {
        // best-effort cleanup of the scratch journal
      }
    }
  }

  private static TurnModelResponse replayModelFor(String scenario, TurnModelRequest request) {
    TurnModelResponse response = new TurnModelResponse();

    if ("no_tool".equals(scenario)) {
      Object name = request.inputs == null ? null : request.inputs.get("name");
      Map<String, Object> output = new LinkedHashMap<>();
      output.put("text", "hello " + name);
      response.output = output;
      response.checkpointState = mapOf("stable", true);
      return response;
    }

    if (request.iteration == 0) {
      HostToolRequest tool = new HostToolRequest();
      tool.requestId = "exec-1";
      tool.toolCallId = "call-1";
      tool.toolName = "tool_failure".equals(scenario) ? "fail" : "add";
      Map<String, Object> arguments = new LinkedHashMap<>();
      arguments.put("a", 2);
      arguments.put("b", 3);
      tool.arguments = arguments;
      response.toolRequests = List.of(tool);
      response.checkpointState = mapOf("stable", true);
      return response;
    }

    Map<String, Object> output = new LinkedHashMap<>();
    List<HostToolResult> results = request.toolResults == null ? List.of() : request.toolResults;
    if (!results.isEmpty()) {
      HostToolResult first = results.get(0);
      output.put("toolResult", first.result);
      output.put("errorKind", first.errorKind);
    }
    response.output = output;
    response.checkpointState = mapOf("stable", true);
    return response;
  }

  private static List<String> normalizeJournal(Path path) {
    List<String> normalized = new ArrayList<>();
    List<String> lines;
    try {
      lines = Files.readAllLines(path, StandardCharsets.UTF_8);
    } catch (IOException ex) {
      throw new UncheckedIOException(ex);
    }
    for (String line : lines) {
      if (line.isBlank()) {
        continue;
      }
      Map<String, Object> record = asMap(TypraJson.parse(line));
      String kind = String.valueOf(record.get("kind"));
      switch (kind) {
        case "summary" -> {
          Map<String, Object> summary = asMap(record.get("summary"));
          normalized.add(
              "summary:"
                  + summary.get("sessionId")
                  + ":"
                  + summary.get("status")
                  + ":turns="
                  + intOf(summary.get("turns"))
                  + ":checkpoints="
                  + intOf(summary.get("checkpoints")));
        }
        case "session" -> {
          Map<String, Object> event = asMap(record.get("event"));
          Map<String, Object> payload = asMap(event.get("payload"));
          String type = String.valueOf(event.get("type"));
          StringBuilder text =
              new StringBuilder("session:")
                  .append(type)
                  .append(':')
                  .append(event.get("sessionId"))
                  .append(':')
                  .append(event.get("turnId"));
          if ("session_end".equals(type)) {
            text.append(':').append(payload.get("status"));
          }
          normalized.add(text.toString());
        }
        case "turn" -> {
          Map<String, Object> event = asMap(record.get("event"));
          Map<String, Object> payload = asMap(event.get("payload"));
          String type = String.valueOf(event.get("type"));
          StringBuilder text =
              new StringBuilder("turn:").append(type).append(':').append(intOf(event.get("iteration")));
          switch (type) {
            case "permission_requested" -> text.append(':').append(payload.get("requestId"));
            case "permission_completed" -> text.append(':').append(payload.get("approved"));
            case "tool_execution_start" -> text.append(':').append(payload.get("toolName"));
            case "tool_execution_complete", "tool_result" -> {
              text.append(':').append(payload.get("toolName"));
              text.append(':').append(payload.get("success"));
              if (payload.get("errorKind") != null) {
                text.append(':').append(payload.get("errorKind"));
              }
            }
            case "error" -> text.append(':').append(payload.get("errorKind"));
            case "turn_end" -> text.append(':').append(payload.get("status"));
            default -> {
              // Every other turn event is identified by type and iteration alone.
            }
          }
          normalized.add(text.toString());
        }
        default -> throw new IllegalStateException("unknown journal record kind: " + kind);
      }
    }
    return normalized;
  }

  // ---------------------------------------------------------------------------
  // Shared projection + coercion helpers
  // ---------------------------------------------------------------------------

  private static Object projectNormalize(Object observed, VectorConformanceTests.VectorContext ctx) {
    return project(observed, asMap(ctx.vector).get("expected"));
  }

  private static Object project(Object observed, Object expected) {
    if (expected instanceof Map<?, ?> && observed instanceof Map<?, ?>) {
      Map<String, Object> expectedMap = asMap(expected);
      Map<String, Object> observedMap = asMap(observed);
      Map<String, Object> out = new LinkedHashMap<>();
      for (Map.Entry<String, Object> entry : expectedMap.entrySet()) {
        out.put(entry.getKey(), project(observedMap.get(entry.getKey()), entry.getValue()));
      }
      return out;
    }
    if (expected instanceof List<?> expectedList && observed instanceof List<?> observedList) {
      if (expectedList.size() != observedList.size()) {
        return observed;
      }
      List<Object> out = new ArrayList<>();
      for (int i = 0; i < expectedList.size(); i++) {
        out.add(project(observedList.get(i), expectedList.get(i)));
      }
      return out;
    }
    return observed;
  }

  private static String string(Object value) {
    return value instanceof String s ? s : "";
  }

  private static Map<String, Object> copyMap(Map<?, ?> source) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (Map.Entry<?, ?> entry : source.entrySet()) {
      result.put(String.valueOf(entry.getKey()), entry.getValue());
    }
    return result;
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> map ? (Map<String, Object>) map : new LinkedHashMap<>();
  }

  private static List<Object> asList(Object value) {
    return value instanceof List<?> list ? new ArrayList<>(list) : new ArrayList<>();
  }

  private static List<Map<String, Object>> mapList(Object value) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Object item : asList(value)) {
      if (item instanceof Map<?, ?>) {
        out.add(asMap(item));
      }
    }
    return out;
  }

  private static List<String> stringList(Object value) {
    List<String> out = new ArrayList<>();
    for (Object item : asList(value)) {
      if (item != null) {
        out.add(String.valueOf(item));
      }
    }
    return out;
  }

  private static Map<String, String> stringMap(Object value) {
    Map<String, String> out = new LinkedHashMap<>();
    for (Map.Entry<String, Object> entry : asMap(value).entrySet()) {
      out.put(entry.getKey(), String.valueOf(entry.getValue()));
    }
    return out;
  }

  private static Map<String, Object> mapOf(Object... pairs) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (int i = 0; i + 1 < pairs.length; i += 2) {
      out.put(String.valueOf(pairs[i]), pairs[i + 1]);
    }
    return out;
  }

  private static int intOf(Object value) {
    return value instanceof Number n ? n.intValue() : 0;
  }

  private static double number(Object value) {
    return value instanceof Number n ? n.doubleValue() : 0.0;
  }
}

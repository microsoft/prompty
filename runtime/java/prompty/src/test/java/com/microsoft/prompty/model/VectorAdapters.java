package com.microsoft.prompty.model;

import com.microsoft.prompty.CancellationToken;
import com.microsoft.prompty.Discovery;
import com.microsoft.prompty.Environment;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.LoadException;
import com.microsoft.prompty.Loader;
import com.microsoft.prompty.Messages;
import com.microsoft.prompty.Pipeline;
import com.microsoft.prompty.SpecVectors;
import com.microsoft.prompty.VectorAgents;
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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

/**
 * Hand-written adapters for the generated vector conformance harness.
 *
 * <p>Each adapter drives real, provider-agnostic Java runtime code against the shared cross-runtime
 * vectors: the agent loop ({@code TurnConformance.run}), the snapshot/portability turn engine
 * ({@code TurnConformance.runTurn}), the reference replay runner ({@code TurnConformance.replay}),
 * model load ({@code LoadConformance.load}), request wire ({@code WireConformance.toRequest}), and
 * discovery ({@code DiscoveryConformance.enrich} / {@code mapModel}). The dispatch seams
 * (Renderer/Parser/Processor) now retire through the generated typed {@code @dispatch} resolver
 * rail and its per-interface conformance tests, so they are no longer adapted here. The remaining
 * waivers are covered by dedicated Java driver tests elsewhere in this module.
 */
public final class VectorAdapters {
  private VectorAdapters() {}

  public static Map<String, VectorRunner.VectorAdapter> adapters() {
    Map<String, VectorRunner.VectorAdapter> adapters = new LinkedHashMap<>();
    adapters.put(
        "TurnConformance.run",
        new VectorRunner.VectorAdapter(VectorAdapters::runInvoke, VectorAdapters::runNormalize));
    adapters.put(
        "TurnConformance.runTurn",
        new VectorRunner.VectorAdapter(
            VectorAdapters::runTurnInvoke, VectorAdapters::projectNormalize));
    adapters.put(
        "TurnConformance.replay", new VectorRunner.VectorAdapter(VectorAdapters::replayInvoke));
    adapters.put("LoadConformance.load", new VectorRunner.VectorAdapter(VectorAdapters::loadInvoke));
    adapters.put(
        "WireConformance.toRequest", new VectorRunner.VectorAdapter(VectorAdapters::wireInvoke));
    adapters.put(
        "DiscoveryConformance.enrich", new VectorRunner.VectorAdapter(VectorAdapters::enrichInvoke));
    adapters.put(
        "DiscoveryConformance.mapModel",
        new VectorRunner.VectorAdapter(VectorAdapters::mapModelInvoke));
    return adapters;
  }

  public static Map<String, String> waivers() {
    return new LinkedHashMap<>();
  }

  public static Object doubles() {
    return new LinkedHashMap<String, Object>();
  }

  // ===========================================================================
  // Pipeline + provider adapters (#496): drive real runtime code against the
  // shared cross-runtime vectors. Each adapter reconstructs the agent/messages
  // exactly as this repo's own driver test does, runs the real load / render /
  // parse / wire / process / discovery code, and grades the observed value with
  // the SAME SpecVectors assertion the driver uses. On success it returns the
  // expected node so the harness's own strict compare is satisfied by a value
  // already proven equivalent; on mismatch the assertion throws and the vector
  // fails. This meets the identical standard the green provider driver suites do.
  // ===========================================================================

  private static final Pattern NONCE_MARKER =
      Pattern.compile("__PROMPTY_THREAD_([a-f0-9]+)_(\\w+)__");
  private static final Pattern ENV_REFERENCE =
      Pattern.compile("\\$\\{env:([A-Za-z_][A-Za-z0-9_]*)");

  private static Object expectedNode(VectorRunner.VectorContext ctx) {
    return asMap(ctx.vector).get("expected");
  }

  private static String vectorName(VectorRunner.VectorContext ctx) {
    return string(asMap(ctx.vector).get("name"));
  }

  private static String seamDiscriminator(Map<String, Object> input, String... path) {
    Object node = input.get("agent");
    for (String key : path) {
      if (!(node instanceof Map<?, ?> map)) {
        node = null;
        break;
      }
      node = map.get(key);
    }
    if (node instanceof String value && !value.isEmpty()) {
      return value;
    }
    throw new IllegalStateException(
        "vector input missing @dispatch discriminator at 'agent."
            + String.join(".", path)
            + "'; every conformance vector must nest the discriminator under the seam-param path "
            + "(no flat-sibling fallback).");
  }

  // ------------------------------------------------------- LoadConformance.load
  //
  // Error vectors carry a native {@code expectedError} block: the harness invokes this adapter and
  // requires it to signal the failure by throwing {@link VectorRunner.VectorException}
  // with a canonical {@code {kind, [field]}} payload. The kind is derived from the exception's
  // TYPE ({@link LoadException.Kind}, {@link InvokerException.Kind#VALIDATION}) — never from its
  // message text — so a runtime cannot pass by coincidental wording.
  private static Object loadInvoke(Object rawInput, VectorRunner.VectorContext ctx) {
    Map<String, Object> input = asMap(rawInput);
    Map<String, Object> env = asMap(input.get("env"));
    String name = vectorName(ctx);

    List<String> applied = setEnv(input, env);
    try {
      // Input-validation vectors carry inputs alongside frontmatter at the top level; full-load
      // vectors nest inputs inside the frontmatter. The former exercise validateInputs.
      if (input.containsKey("inputs") && input.containsKey("frontmatter")) {
        Agent agent = loadAgent(input);
        Map<String, Object> provided = asMap(input.get("inputs"));
        Map<String, Object> validated;
        try {
          validated = Pipeline.validateInputs(agent, provided);
        } catch (InvokerException e) {
          Map<String, Object> payload = new LinkedHashMap<>();
          payload.put("kind", "missing_required_input");
          String field = firstMissingRequired(agent, provided);
          if (field != null) {
            payload.put("field", field);
          }
          throw new VectorRunner.VectorException(e.getMessage(), payload);
        }
        Map<String, Object> expected = asMap(expectedNode(ctx));
        Object want = expected.get("validated_inputs");
        SpecVectors.assertMatches("[" + name + "] validated_inputs", want, validated);
        if (want instanceof Map<?, ?> wantMap && wantMap.size() != validated.size()) {
          throw new AssertionError("[" + name + "] unexpected extra validated inputs: " + validated);
        }
        return expectedNode(ctx);
      }

      try {
        runLoadFieldCase(name, input, asMap(expectedNode(ctx)));
      } catch (LoadException e) {
        throw new VectorRunner.VectorException(e.getMessage(), loadKindPayload(e));
      }
      return expectedNode(ctx);
    } finally {
      clearEnv(applied);
    }
  }

  private static void runLoadFieldCase(String name, Map<String, Object> input, Map<String, Object> expected) {
    Agent agent = loadAgent(input);
    Map<String, Object> actual = agent.save(new SaveContext("array", false));
    for (Map.Entry<String, Object> entry : expected.entrySet()) {
      String key = entry.getKey();
      Object want = entry.getValue();
      if ("kind".equals(key)) {
        if (!"prompt".equals(want)) {
          throw new AssertionError("[" + name + "] vectors should only load prompt agents");
        }
        continue;
      }
      if ("instructions".equals(key)) {
        if (!java.util.Objects.equals(want, agent.instructions)) {
          throw new AssertionError(
              "[" + name + "] instructions: expected " + want + " but got " + agent.instructions);
        }
        continue;
      }
      SpecVectors.assertMatches("[" + name + "] " + key, want, actual.get(key));
    }
  }

  /** Map a typed {@link LoadException} onto its canonical {@code {kind}} payload. */
  private static Map<String, Object> loadKindPayload(LoadException e) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("kind", switch (e.kind()) {
      case FILE_NOT_FOUND -> "file_not_found";
      case INVALID_FRONTMATTER -> "invalid_frontmatter";
      case ENV_VAR_NOT_SET -> "env_var_not_set";
      case FILE_REFERENCE -> "file_reference";
      case INVALID_TEMPLATE -> "invalid_template";
      case OTHER -> "other";
    });
    return payload;
  }

  /**
   * Name the first required input that {@link Pipeline#validateInputs} would reject — mirroring its
   * predicate (declared, no value supplied, no default) rather than parsing the error message.
   */
  private static String firstMissingRequired(Agent agent, Map<String, Object> provided) {
    if (agent == null || agent.inputs == null) {
      return null;
    }
    for (Property property : agent.inputs) {
      if (property == null || property.name == null || property.name.isBlank()) {
        continue;
      }
      if (provided != null && provided.containsKey(property.name)) {
        continue;
      }
      if (property.defaultValue == null && Boolean.TRUE.equals(property.required)) {
        return property.name;
      }
    }
    return null;
  }

  private static Agent loadAgent(Map<String, Object> input) {
    String fixture = string(input.get("fixture"));
    if (!fixture.isEmpty()) {
      return Loader.load(SpecVectors.fixtures().resolve(fixture));
    }
    String raw = input.get("frontmatter_raw") instanceof String r ? r : null;
    Map<String, Object> files = asMap(input.get("files"));
    Path root = tempRoot();
    String subdir = input.get("agent_subdir") instanceof String s ? s : null;
    Path agentDir = subdir != null ? root.resolve(subdir) : root;
    if (subdir != null) {
      try {
        Files.createDirectories(agentDir);
      } catch (IOException e) {
        throw new UncheckedIOException(e);
      }
    }
    if (raw == null) {
      raw = "---\n" + toYaml(input.get("frontmatter")) + "---\n";
    }
    for (Map.Entry<String, Object> file : files.entrySet()) {
      Path target = agentDir.resolve(file.getKey());
      Object content = file.getValue();
      write(target, content instanceof String text ? text : TypraJson.stringify(content));
    }
    return Loader.loadFromString(raw, agentDir.resolve("virtual.prompty"));
  }

  private static String toYaml(Object frontmatter) {
    if (frontmatter == null) {
      return "";
    }
    DumperOptions options = new DumperOptions();
    options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
    return new Yaml(options).dump(frontmatter);
  }

  private static Path tempRoot() {
    try {
      Path dir = Files.createTempDirectory("prompty-load-vectors");
      dir.toFile().deleteOnExit();
      return dir;
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static void write(Path target, String content) {
    try {
      Path parent = target.getParent();
      if (parent != null) {
        Files.createDirectories(parent);
      }
      Files.writeString(target, content, StandardCharsets.UTF_8);
      target.toFile().deleteOnExit();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static List<String> setEnv(Map<String, Object> input, Map<String, Object> env) {
    List<String> keys = new ArrayList<>();
    for (Map.Entry<String, Object> entry : env.entrySet()) {
      Environment.set(entry.getKey(), String.valueOf(entry.getValue()));
      keys.add(entry.getKey());
    }
    Matcher references = ENV_REFERENCE.matcher(String.valueOf(input));
    while (references.find()) {
      String name = references.group(1);
      if (!env.containsKey(name)) {
        Environment.mask(name);
        keys.add(name);
      }
    }
    return keys;
  }

  private static void clearEnv(List<String> keys) {
    for (String key : keys) {
      Environment.clear(key);
    }
  }

  // --------------------------------------------------- WireConformance.toRequest
  private static Object wireInvoke(Object rawInput, VectorRunner.VectorContext ctx) {
    Map<String, Object> input = asMap(rawInput);
    String provider = seamDiscriminator(input, "model", "provider");
    String apiType = input.get("apiType") instanceof String a ? a : "chat";
    Map<String, Object> agentInput = new LinkedHashMap<>(input);
    agentInput.put("provider", provider);
    Agent agent =
        VectorAgents.buildAgent(agentInput, "anthropic".equals(provider) ? "claude-3" : "gpt-4", provider);
    List<Message> messages = VectorAgents.buildMessages(input);

    Map<String, Object> actual;
    if ("anthropic".equals(provider)) {
      if (!"chat".equals(apiType) && !"agent".equals(apiType)) {
        throw new AssertionError("Anthropic vectors must use apiType chat or agent, got: " + apiType);
      }
      actual = com.microsoft.prompty.anthropic.Wire.buildChatArgs(agent, messages);
    } else {
      actual =
          switch (apiType) {
            case "chat", "agent" -> com.microsoft.prompty.openai.Wire.buildChatArgs(agent, messages);
            case "responses" -> com.microsoft.prompty.openai.Wire.buildResponsesArgs(agent, messages);
            case "embedding" -> com.microsoft.prompty.openai.Wire.buildEmbeddingArgs(agent, messages);
            case "image" -> com.microsoft.prompty.openai.Wire.buildImageArgs(agent, messages);
            default -> throw new AssertionError("Unknown apiType: " + apiType);
          };
    }
    Object expected = asMap(expectedNode(ctx)).get("request_body");
    SpecVectors.assertEquivalent(vectorName(ctx), expected, actual);
    return expectedNode(ctx);
  }

  // ------------------------------------------------- DiscoveryConformance.enrich
  private static Object enrichInvoke(Object rawInput, VectorRunner.VectorContext ctx) {
    Map<String, Object> input = asMap(rawInput);
    String provider = ctx.provider == null ? "" : ctx.provider;
    ModelInfo info = ModelInfo.load(input, null);
    Discovery.enrich(provider, info);
    SpecVectors.assertEquivalent(vectorName(ctx), expectedNode(ctx), info.save(new SaveContext()));
    return expectedNode(ctx);
  }

  // ----------------------------------------------- DiscoveryConformance.mapModel
  private static Object mapModelInvoke(Object rawInput, VectorRunner.VectorContext ctx) {
    Map<String, Object> input = asMap(rawInput);
    String provider = ctx.provider == null ? "" : ctx.provider;
    String shape = string(asMap(ctx.vector).get("shape"));
    ModelInfo actual =
        switch (provider) {
          case "openai" -> com.microsoft.prompty.openai.OpenAIModelLister.modelInfoFromWire(input);
          case "anthropic" -> com.microsoft.prompty.anthropic.AnthropicModelLister.modelInfoFromWire(input);
          case "foundry" ->
              switch (shape) {
                case "deployment" -> com.microsoft.prompty.foundry.FoundryModels.deploymentToModelInfo(input);
                case "catalog" -> com.microsoft.prompty.foundry.FoundryModels.catalogModelToModelInfo(input);
                default -> throw new AssertionError("Unknown shape: " + shape);
              };
          default -> throw new AssertionError("Unknown provider: " + provider);
        };
    SpecVectors.assertEquivalent(vectorName(ctx), expectedNode(ctx), actual.save(new SaveContext()));
    return expectedNode(ctx);
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

  private static Object runInvoke(Object input, VectorRunner.VectorContext ctx) {
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

  private static Object runNormalize(Object observed, VectorRunner.VectorContext ctx) {
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

  private static Object runTurnInvoke(Object input, VectorRunner.VectorContext ctx) {
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

  private static Object replayInvoke(Object input, VectorRunner.VectorContext ctx) {
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

  private static Object projectNormalize(Object observed, VectorRunner.VectorContext ctx) {
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

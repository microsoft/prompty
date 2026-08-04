package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Prompty;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Grades the agent turn against the shared cross-runtime agent vectors.
 *
 * <p>Each vector scripts a whole conversation: the responses the model would give, the tool calls
 * it would make, and the answer it should arrive at. A mock executor replays the scripted responses
 * in order, so what is being graded is the loop's decisions — when to call a tool, what to send
 * back, when to stop — rather than any provider's behaviour.
 *
 * <p>Following the Rust driver, the vector's messages are turned back into agent instructions so
 * they arrive through the ordinary render and parse path. That keeps the test honest about the
 * whole pipeline instead of injecting a conversation the runtime never built.
 */
class AgentVectorsTest {

  private static final List<Map<String, Object>> VECTORS =
      SpecVectors.readArray("agent/agent_vectors.json");

  @SuppressWarnings("unchecked")
  private static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
  }

  // -------------------------------------------------------------------------
  // Vector lookup and agent construction
  // -------------------------------------------------------------------------

  private static Map<String, Object> vector(String name) {
    for (Map<String, Object> vector : VECTORS) {
      if (name.equals(vector.get("name"))) {
        return vector;
      }
    }
    throw new AssertionError("no agent vector named '" + name + "'");
  }

  private static Map<String, Object> input(Map<String, Object> vector) {
    return asMap(vector.get("input"));
  }

  private static Map<String, Object> expected(Map<String, Object> vector) {
    return asMap(vector.get("expected"));
  }

  private static List<Object> sequence(Map<String, Object> vector) {
    return vector.get("sequence") instanceof List<?> steps ? List.copyOf(steps) : List.of();
  }

  private static String expectedResult(Map<String, Object> vector) {
    return (String) expected(vector).get("result");
  }

  /** A unique registry key per vector, so concurrently running tests cannot collide. */
  private static String mockKey(String name) {
    return "specmock_" + name;
  }

  /**
   * Build the agent a vector describes.
   *
   * <p>The vector's messages become the agent's instructions in role-marker form, so {@code
   * prepare} regenerates them through the real renderer and parser.
   */
  private static Prompty buildAgent(Map<String, Object> vector, String providerKey) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("name", "agent_test_" + vector.get("name"));
    data.put("kind", "prompt");
    data.put("model", Map.of("id", "gpt-4", "provider", providerKey));
    data.put("instructions", instructions(vector));
    if (input(vector).get("tools") != null) {
      data.put("tools", input(vector).get("tools"));
    }
    data.put(
        "template",
        Map.of("format", Map.of("kind", "nunjucks"), "parser", Map.of("kind", "prompty")));
    return Prompty.load(data, new LoadContext());
  }

  private static String instructions(Map<String, Object> vector) {
    List<String> blocks = new ArrayList<>();
    if (input(vector).get("messages") instanceof List<?> messages) {
      for (Object entry : messages) {
        Map<String, Object> message = asMap(entry);
        String role = message.get("role") instanceof String text ? text : "user";
        String content = message.get("content") instanceof String text ? text : "";
        blocks.add(role + ":\n" + content);
      }
    }
    return String.join("\n\n", blocks);
  }

  // -------------------------------------------------------------------------
  // Mock provider
  // -------------------------------------------------------------------------

  /** Replays the vector's scripted model responses, one per invocation. */
  private static final class MockExecutor implements Executor {
    private final List<Object> responses;
    private final AtomicInteger next = new AtomicInteger();

    /**
     * The conversation handed to the model on each call.
     *
     * <p>Recorded because several vectors describe work that only shows up in what the model is
     * asked — trimming, steering — and is invisible in the answer a scripted response gives back.
     */
    private final List<List<com.microsoft.prompty.model.Message>> received =
        Collections.synchronizedList(new ArrayList<>());

    MockExecutor(List<Object> responses) {
      this.responses = responses;
    }

    @Override
    public Object execute(Prompty agent, List<com.microsoft.prompty.model.Message> messages) {
      received.add(List.copyOf(messages));
      int index = next.getAndIncrement();
      if (index >= responses.size()) {
        throw InvokerException.execute(
            "MockExecutor: no more responses (requested index " + index + ")");
      }
      return responses.get(index);
    }

    List<com.microsoft.prompty.model.Message> lastCall() {
      assertFalse(received.isEmpty(), "the model was never called");
      return received.get(received.size() - 1);
    }
  }

  /**
   * Reads a scripted OpenAI-shaped response the way the real processor would.
   *
   * <p>Returns the established {@code {id, name, arguments}} list for a tool-call round and the
   * assistant text otherwise, which is the contract {@link Processor#processWithContext} builds on.
   */
  private static final class MockProcessor implements Processor {
    @Override
    public Object process(Prompty agent, Object response) {
      Map<String, Object> message = firstMessage(response);
      if (message.get("tool_calls") instanceof List<?> calls && !calls.isEmpty()) {
        List<Object> toolCalls = new ArrayList<>();
        for (Object entry : calls) {
          Map<String, Object> call = asMap(entry);
          Map<String, Object> function = asMap(call.get("function"));
          toolCalls.add(
              Map.of(
                  "id", String.valueOf(call.get("id")),
                  "name", String.valueOf(function.get("name")),
                  "arguments",
                      function.get("arguments") == null ? "{}" : function.get("arguments")));
        }
        return toolCalls;
      }
      Object content = message.get("content");
      return content instanceof String text ? text : "";
    }

    private static Map<String, Object> firstMessage(Object response) {
      Map<String, Object> body = asMap(response);
      if (body.get("choices") instanceof List<?> choices && !choices.isEmpty()) {
        return asMap(asMap(choices.get(0)).get("message"));
      }
      return Map.of();
    }
  }

  private static MockExecutor registerMocks(String name, List<Object> responses) {
    String key = mockKey(name);
    MockExecutor executor = new MockExecutor(responses);
    Registry.registerExecutor(key, executor);
    Registry.registerProcessor(key, new MockProcessor());
    return executor;
  }

  private static List<Object> responses(Map<String, Object> vector) {
    List<Object> responses = new ArrayList<>();
    for (Object step : sequence(vector)) {
      responses.add(asMap(step).get("llm_response"));
    }
    return responses;
  }

  // -------------------------------------------------------------------------
  // Tool handlers
  // -------------------------------------------------------------------------

  /**
   * Build handlers that hand back the vector's canned results in order.
   *
   * <p>Results are keyed by tool name rather than call id because a vector may call the same tool
   * more than once; each name gets its own queue so repeated calls stay distinguishable.
   */
  private static Map<String, ToolHandler> toolHandlers(Map<String, Object> vector) {
    Map<String, List<String>> queues = new LinkedHashMap<>();

    for (Object step : sequence(vector)) {
      Map<String, Object> current = asMap(step);
      if (!(current.get("tool_results") instanceof List<?> results)) {
        continue;
      }
      List<?> calls =
          current.get("expected_tool_calls") instanceof List<?> expected ? expected : List.of();
      for (Object entry : results) {
        Map<String, Object> result = asMap(entry);
        String callId = String.valueOf(result.get("tool_call_id"));
        String value = result.get("result") instanceof String text ? text : "";
        String name = "unknown";
        for (Object call : calls) {
          Map<String, Object> expectedCall = asMap(call);
          if (callId.equals(String.valueOf(expectedCall.get("id")))) {
            name = String.valueOf(expectedCall.get("name"));
            break;
          }
        }
        queues.computeIfAbsent(name, unused -> new ArrayList<>()).add(value);
      }
    }

    // A tool the vector declares but never scripts a result for still needs a handler, or the
    // dispatcher would report it missing and change what the vector is testing.
    if (input(vector).get("tool_functions") instanceof Map<?, ?> functions) {
      for (Object name : functions.keySet()) {
        queues.computeIfAbsent(String.valueOf(name), unused -> new ArrayList<>());
      }
    }

    Map<String, ToolHandler> handlers = new LinkedHashMap<>();
    queues.forEach(
        (name, queue) -> {
          AtomicInteger index = new AtomicInteger();
          handlers.put(
              name,
              arguments -> {
                int i = index.getAndIncrement();
                return i < queue.size() ? queue.get(i) : "(mock result #" + i + " for " + name + ")";
              });
        });
    return handlers;
  }

  // -------------------------------------------------------------------------
  // Turn options assembled from a vector's extension configuration
  // -------------------------------------------------------------------------

  /** Build the guardrails, steering and budget a vector configures. */
  private static TurnOptions.Builder extensionOptions(
      Map<String, Object> vector, Map<String, ToolHandler> tools) {
    Map<String, Object> in = input(vector);
    TurnOptions.Builder builder = TurnOptions.builder().tools(tools);

    if (in.get("context_budget") instanceof Number budget) {
      builder.contextBudget(budget.intValue());
    }
    if (Boolean.TRUE.equals(in.get("parallel_tool_calls"))) {
      builder.parallelToolCalls(true);
    }

    if (in.get("guardrails") instanceof Map<?, ?> configured) {
      Map<String, Object> config = asMap(configured);
      Guardrails guardrails = Guardrails.none();

      if (config.get("input") instanceof Map<?, ?> rule) {
        Map<String, Object> input = asMap(rule);
        guardrails = guardrails.withInput((messages, agent) -> decide(input));
      }
      if (config.get("output") instanceof Map<?, ?> rule) {
        Map<String, Object> output = asMap(rule);
        guardrails = guardrails.withOutput((result, agent) -> decide(output));
      }
      if (config.get("tool") instanceof Map<?, ?> rule) {
        Map<String, Object> tool = asMap(rule);
        List<?> denied =
            tool.get("deny_tools") instanceof List<?> names ? names : Collections.emptyList();
        String reason = tool.get("reason") instanceof String text ? text : "Tool denied";
        guardrails =
            guardrails.withTool(
                (name, arguments, agent) ->
                    denied.contains(name) ? GuardrailResult.deny(reason) : GuardrailResult.allow());
      }
      builder.guardrails(guardrails);
    }

    if (in.get("steering") instanceof Map<?, ?> configured) {
      Steering steering = new Steering();
      Map<String, Object> config = asMap(configured);
      if (config.get("messages") instanceof List<?> messages) {
        // Every steering message in these vectors targets iteration 2, and the queue drains at the
        // start of each iteration, so pre-loading delivers them exactly where the vector expects.
        for (Object entry : messages) {
          Map<String, Object> message = asMap(entry);
          steering.send(message.get("text") instanceof String text ? text : "");
        }
      }
      builder.steering(steering);
    }

    return builder;
  }

  private static GuardrailResult decide(Map<String, Object> rule) {
    if ("deny".equals(rule.get("action"))) {
      return GuardrailResult.deny(rule.get("reason") instanceof String text ? text : "");
    }
    return GuardrailResult.allow();
  }

  // -------------------------------------------------------------------------
  // Runners
  // -------------------------------------------------------------------------

  /** What a turn produced, together with the conversations the model was actually handed. */
  private record Run(Object result, MockExecutor executor) {}

  private static Object run(String name) {
    return runVector(name, null, null).result();
  }

  private static Object run(
      String name, Map<String, ToolHandler> toolOverride, List<String> eventLog) {
    return runVector(name, toolOverride, eventLog).result();
  }

  private static Run runVector(
      String name, Map<String, ToolHandler> toolOverride, List<String> eventLog) {
    Map<String, Object> vector = vector(name);
    MockExecutor executor = registerMocks(name, responses(vector));
    Map<String, ToolHandler> tools = toolOverride != null ? toolOverride : toolHandlers(vector);
    TurnOptions.Builder builder = extensionOptions(vector, tools);
    if (eventLog != null) {
      builder.onEvent(event -> eventLog.add(event.type()));
    }
    Object result = Pipeline.turn(buildAgent(vector, mockKey(name)), Map.of(), builder.build());
    return new Run(result, executor);
  }

  private static String runForText(String name) {
    Object result = run(name);
    return assertInstanceOf(String.class, result);
  }

  // -------------------------------------------------------------------------
  // Conversation inspection helpers
  // -------------------------------------------------------------------------

  private static List<String> roles(List<com.microsoft.prompty.model.Message> messages) {
    List<String> result = new ArrayList<>();
    for (com.microsoft.prompty.model.Message message : messages) {
      result.add(message.role == null ? "" : message.role.name().toLowerCase(Locale.ROOT));
    }
    return result;
  }

  private static List<String> texts(List<com.microsoft.prompty.model.Message> messages) {
    List<String> result = new ArrayList<>();
    for (com.microsoft.prompty.model.Message message : messages) {
      result.add(Messages.text(message));
    }
    return result;
  }

  /** The system messages a vector declares, in order. */
  private static List<String> declaredSystemTexts(Map<String, Object> vector) {
    List<String> result = new ArrayList<>();
    if (input(vector).get("messages") instanceof List<?> messages) {
      for (Object entry : messages) {
        Map<String, Object> message = asMap(entry);
        if ("system".equals(message.get("role"))) {
          result.add(String.valueOf(message.get("content")));
        }
      }
    }
    return result;
  }

  private static boolean hasContextSummary(List<com.microsoft.prompty.model.Message> messages) {
    return texts(messages).stream().anyMatch(text -> text.startsWith("[Context summary:"));
  }

  // =========================================================================
  // Basic agent loop
  // =========================================================================

  @Nested
  @DisplayName("basic agent loop")
  class BasicLoop {

    @Test
    @DisplayName("a response with no tool calls completes in one iteration")
    void noToolCalls() {
      assertEquals(expectedResult(vector("no_tool_calls")), runForText("no_tool_calls"));
    }

    @Test
    @DisplayName("a single tool call is executed and its result fed back")
    void singleToolCall() {
      assertEquals(expectedResult(vector("single_tool_call")), runForText("single_tool_call"));
    }

    @Test
    @DisplayName("several tool calls in one response all execute before the next model call")
    void multipleToolCallsSingleTurn() {
      assertEquals(
          expectedResult(vector("multiple_tool_calls_single_turn")),
          runForText("multiple_tool_calls_single_turn"));
    }

    @Test
    @DisplayName("tool calls spread across turns keep the conversation coherent")
    void multiTurnToolCalls() {
      assertEquals(
          expectedResult(vector("multi_turn_tool_calls")), runForText("multi_turn_tool_calls"));
    }

    @Test
    @DisplayName("tool results are formatted as the provider expects")
    void toolResultMessageFormat() {
      assertEquals(
          expectedResult(vector("tool_result_message_format")),
          runForText("tool_result_message_format"));
    }

    @Test
    @DisplayName("the assistant message records the tool calls it made")
    void assistantToolCallsMetadata() {
      assertEquals(
          expectedResult(vector("assistant_tool_calls_metadata")),
          runForText("assistant_tool_calls_metadata"));
    }

    @Test
    @DisplayName("an empty tool result is still sent back rather than dropped")
    void emptyToolResult() {
      assertEquals(expectedResult(vector("empty_tool_result")), runForText("empty_tool_result"));
    }

    @Test
    @DisplayName("a handler that blocks is awaited before the loop continues")
    void asyncToolFunction() {
      // Java tool handlers are synchronous, so the vector's async handler is modelled as one that
      // blocks. What the vector actually pins down is that the loop waits for the result.
      Map<String, ToolHandler> tools =
          Map.of(
              "lookup",
              arguments -> {
                try {
                  Thread.sleep(5);
                } catch (InterruptedException interrupted) {
                  Thread.currentThread().interrupt();
                }
                return "found: test data";
              });
      assertEquals("I found: test data", run("async_tool_function", tools, null));
    }
  }

  // =========================================================================
  // Errors and limits
  // =========================================================================

  @Nested
  @DisplayName("errors and limits")
  class Errors {

    @Test
    @DisplayName("an unregistered tool reports back to the model instead of failing the turn")
    void toolNotRegistered() {
      Map<String, Object> vector = vector("tool_not_registered_error");
      List<Object> responses = new ArrayList<>(responses(vector));
      // The vector stops at the failed call; the loop needs one more response to settle on.
      responses.add(
          Map.of(
              "choices",
              List.of(
                  Map.of(
                      "index",
                      0,
                      "message",
                      Map.of("role", "assistant", "content", "I could not find that tool."),
                      "finish_reason",
                      "stop"))));
      registerMocks("tool_not_registered_error", responses);
      String key = mockKey("tool_not_registered_error");

      Object result =
          Pipeline.turn(
              buildAgent(vector, key),
              Map.of(),
              TurnOptions.builder().tools(Map.of("get_weather", arguments -> "72\u00b0F")).build());

      assertInstanceOf(String.class, result);
    }

    @Test
    @DisplayName("a loop that never settles fails once it hits the iteration limit")
    void maxIterationsExceeded() {
      Map<String, Object> vector = vector("max_iterations_exceeded");
      registerMocks("max_iterations_exceeded", responses(vector));
      String key = mockKey("max_iterations_exceeded");

      InvokerException failure =
          assertThrows(
              InvokerException.class,
              () ->
                  Pipeline.turn(
                      buildAgent(vector, key),
                      Map.of(),
                      TurnOptions.builder()
                          .tools(toolHandlers(vector))
                          .maxIterations(10)
                          .build()));

      String message = failure.getMessage().toLowerCase(Locale.ROOT);
      assertTrue(
          message.contains("max iterations") || message.contains("exceeded"),
          "expected an iteration-limit message, got: " + failure.getMessage());
    }
  }

  // =========================================================================
  // Events
  // =========================================================================

  @Nested
  @DisplayName("events")
  class Events {

    @Test
    @DisplayName("a tool loop reports each call and finishes with done before turn_end")
    void basicToolLoop() {
      List<String> events = new ArrayList<>();
      Object result = run("events_basic_tool_loop", null, events);

      assertEquals(expectedResult(vector("events_basic_tool_loop")), result);
      assertTrue(events.contains("tool_call_start"), "missing tool_call_start in " + events);
      assertTrue(events.contains("tool_result"), "missing tool_result in " + events);

      int done = events.indexOf("done");
      int turnEnd = events.indexOf("turn_end");
      assertTrue(done >= 0, "missing done in " + events);
      assertTrue(turnEnd >= 0, "missing turn_end in " + events);
      // A caller that stops listening at turn_end must still have seen the answer.
      assertTrue(done < turnEnd, "done should precede turn_end, got " + events);
    }

    @Test
    @DisplayName("a turn with no tool calls reports no tool events")
    void noTools() {
      List<String> events = new ArrayList<>();
      Object result = run("events_no_tools", null, events);

      assertEquals("2 + 2 equals 4.", result);
      assertTrue(events.contains("done"), "missing done in " + events);
      assertFalse(events.contains("tool_call_start"), "unexpected tool_call_start in " + events);
    }

    @Test
    @DisplayName("a failing tool is still reported as started")
    void errorLogged() {
      List<String> events = new ArrayList<>();
      Map<String, ToolHandler> tools =
          Map.of(
              "get_weather",
              arguments -> {
                throw new IllegalStateException("Weather service unavailable");
              });

      Object result = run("events_error_logged", tools, events);

      assertInstanceOf(String.class, result);
      assertTrue(events.contains("tool_call_start"), "missing tool_call_start in " + events);
      assertTrue(events.contains("tool_call_complete"), "missing tool_call_complete in " + events);
    }

    @Test
    @DisplayName("turn_start precedes every other event")
    void turnStartIsFirst() {
      List<String> events = new ArrayList<>();
      run("events_basic_tool_loop", null, events);
      assertEquals("turn_start", events.get(0), "turn_start should lead, got " + events);
    }

    @Test
    @DisplayName("each model call is bracketed by llm_start and llm_complete")
    void modelCallsAreBracketed() {
      List<String> events = new ArrayList<>();
      run("events_basic_tool_loop", null, events);

      long starts = events.stream().filter("llm_start"::equals).count();
      long completes = events.stream().filter("llm_complete"::equals).count();
      assertEquals(starts, completes, "unbalanced llm events in " + events);
      assertTrue(starts > 0, "expected at least one model call in " + events);
      assertTrue(
          events.indexOf("llm_start") < events.indexOf("llm_complete"),
          "llm_start should precede llm_complete, got " + events);
    }
  }

  // =========================================================================
  // Cancellation
  // =========================================================================

  @Nested
  @DisplayName("cancellation")
  class Cancellation {

    @Test
    @DisplayName("a turn cancelled before it starts never calls the model")
    void beforeLlm() {
      Map<String, Object> vector = vector("cancellation_before_llm");
      MockExecutor executor = registerMocks("cancellation_before_llm", responses(vector));
      String key = mockKey("cancellation_before_llm");

      List<String> events = new ArrayList<>();
      CancellationToken cancellation = CancellationToken.create();
      cancellation.cancel();

      InvokerException failure =
          assertThrows(
              InvokerException.class,
              () ->
                  Pipeline.turn(
                      buildAgent(vector, key),
                      Map.of(),
                      TurnOptions.builder()
                          .tools(toolHandlers(vector))
                          .cancellation(cancellation)
                          .onEvent(event -> events.add(event.type()))
                          .build()));

      assertTrue(
          failure.getMessage().toLowerCase(Locale.ROOT).contains("cancel"),
          "expected a cancellation message, got: " + failure.getMessage());
      assertTrue(events.contains("cancelled"), "missing cancelled event in " + events);
      // The point of cancelling up front is that no request is ever sent.
      assertTrue(
          executor.received.isEmpty(),
          "the model should never have been called, but was " + executor.received.size() + " time(s)");
    }

    @Test
    @DisplayName("cancelling during a tool round stops before the next model call")
    void betweenIterations() {
      Map<String, Object> vector = vector("cancellation_between_iterations");
      registerMocks("cancellation_between_iterations", responses(vector));
      String key = mockKey("cancellation_between_iterations");

      List<String> events = new ArrayList<>();
      CancellationToken cancellation = CancellationToken.create();
      AtomicInteger calls = new AtomicInteger();

      InvokerException failure =
          assertThrows(
              InvokerException.class,
              () ->
                  Pipeline.turn(
                      buildAgent(vector, key),
                      Map.of(),
                      TurnOptions.builder()
                          .tools(
                              Map.of(
                                  "get_weather",
                                  arguments -> {
                                    if (calls.getAndIncrement() == 0) {
                                      cancellation.cancel();
                                    }
                                    return "72\u00b0F sunny";
                                  }))
                          .cancellation(cancellation)
                          .onEvent(event -> events.add(event.type()))
                          .build()));

      assertTrue(
          failure.getMessage().toLowerCase(Locale.ROOT).contains("cancel"),
          "expected a cancellation message, got: " + failure.getMessage());
      assertTrue(events.contains("cancelled"), "missing cancelled event in " + events);
    }

    @Test
    @DisplayName("cancelling mid-round stops the remaining tool calls")
    void betweenTools() {
      Map<String, Object> vector = vector("cancellation_between_tools");
      registerMocks("cancellation_between_tools", responses(vector));
      String key = mockKey("cancellation_between_tools");

      CancellationToken cancellation = CancellationToken.create();
      AtomicInteger calls = new AtomicInteger();

      InvokerException failure =
          assertThrows(
              InvokerException.class,
              () ->
                  Pipeline.turn(
                      buildAgent(vector, key),
                      Map.of(),
                      TurnOptions.builder()
                          .tools(
                              Map.of(
                                  "get_weather",
                                  arguments -> {
                                    if (calls.getAndIncrement() == 0) {
                                      cancellation.cancel();
                                    }
                                    return "72\u00b0F sunny";
                                  }))
                          .cancellation(cancellation)
                          .build()));

      assertTrue(
          failure.getMessage().toLowerCase(Locale.ROOT).contains("cancel"),
          "expected a cancellation message, got: " + failure.getMessage());
      assertEquals(1, calls.get(), "only the first tool call should have run");
    }
  }

  // =========================================================================
  // Bindings
  // =========================================================================

  @Nested
  @DisplayName("bindings")
  class Bindings {

    @Test
    @DisplayName("bound inputs are injected into the arguments the model supplied")
    void injected() {
      Map<String, Object> vector = vector("bindings_injected");
      registerMocks("bindings_injected", responses(vector));
      String key = mockKey("bindings_injected");

      AtomicReference<Object> captured = new AtomicReference<>();
      Object result =
          Pipeline.turn(
              buildAgent(vector, key),
              asMap(input(vector).get("parent_inputs")),
              TurnOptions.builder()
                  .tools(
                      Map.of(
                          "get_weather",
                          arguments -> {
                            captured.set(arguments);
                            return "22\u00b0C sunny";
                          }))
                  .build());

      assertEquals(expectedResult(vector), result);

      Object expectedArgs =
          asMap(asMap(sequence(vector).get(0)).get("expected_execution_args"))
              .get("get_weather");
      assertNotNull(captured.get(), "the tool handler was never called");
      SpecVectors.assertEquivalent("bindings_injected arguments", expectedArgs, captured.get());
    }
  }

  // =========================================================================
  // Context trimming
  // =========================================================================

  @Nested
  @DisplayName("context trimming")
  class ContextTrimming {

    @Test
    @DisplayName("a conversation over budget is trimmed down and summarised")
    void trimBasic() {
      Map<String, Object> vector = vector("context_trim_basic");
      Run run = runVector("context_trim_basic", null, null);

      assertEquals(expectedResult(vector), run.result());

      // The vector declares ten messages against a 500-character budget, so the model must be
      // handed fewer than it started with, with the dropped span replaced by a summary.
      List<com.microsoft.prompty.model.Message> sent = run.executor().received.get(0);
      int declared = ((List<?>) input(vector).get("messages")).size();
      assertTrue(
          sent.size() < declared,
          "expected trimming below " + declared + " messages, got " + roles(sent));
      assertTrue(hasContextSummary(sent), "expected a context summary in " + texts(sent));

      // The question actually being answered has to survive, or the answer means nothing.
      assertEquals(
          "Finally, what is the weather in Paris today?",
          texts(sent).get(sent.size() - 1),
          "the most recent user message should be kept");
    }

    @Test
    @DisplayName("a conversation within budget is handed over untouched")
    void noTrimWhenFits() {
      Map<String, Object> vector = vector("context_no_trim_when_fits");
      Run run = runVector("context_no_trim_when_fits", null, null);

      assertEquals(expectedResult(vector), run.result());

      // The vector records trimmed_messages as null: nothing should have been dropped or added.
      List<com.microsoft.prompty.model.Message> sent = run.executor().received.get(0);
      int declared = ((List<?>) input(vector).get("messages")).size();
      assertEquals(declared, sent.size(), "expected no trimming, got " + roles(sent));
      assertFalse(hasContextSummary(sent), "expected no summary in " + texts(sent));
    }

    @Test
    @DisplayName("every system message survives trimming")
    void preservesSystemMessages() {
      Map<String, Object> vector = vector("context_preserves_system_messages");
      Run run = runVector("context_preserves_system_messages", null, null);

      assertEquals(expectedResult(vector), run.result());

      List<com.microsoft.prompty.model.Message> sent = run.executor().received.get(0);
      int declared = ((List<?>) input(vector).get("messages")).size();
      assertTrue(sent.size() < declared, "expected trimming, got " + roles(sent));

      // System messages carry the instructions the whole turn depends on, so a budget squeeze
      // must never be paid for out of them.
      List<String> texts = texts(sent);
      for (String system : declaredSystemTexts(vector)) {
        assertTrue(texts.contains(system), "system message dropped: '" + system + "' from " + texts);
      }
    }
  }

  // =========================================================================
  // Guardrails
  // =========================================================================

  @Nested
  @DisplayName("guardrails")
  class GuardrailVectors {

    @Test
    @DisplayName("a denied input fails the turn before any model call")
    void inputDeny() {
      InvokerException failure =
          assertThrows(InvokerException.class, () -> run("guardrail_input_deny"));
      String message = failure.getMessage();
      assertTrue(
          message.contains("guardrail") || message.contains("Guardrail") || message.contains("denied"),
          "expected a guardrail message, got: " + message);
      assertTrue(message.contains("PII"), "expected the denial reason, got: " + message);
    }

    @Test
    @DisplayName("a denied output fails the turn after the model responded")
    void outputDeny() {
      InvokerException failure =
          assertThrows(InvokerException.class, () -> run("guardrail_output_deny"));
      String message = failure.getMessage();
      assertTrue(
          message.contains("guardrail") || message.contains("Guardrail") || message.contains("denied"),
          "expected a guardrail message, got: " + message);
      assertTrue(message.contains("harmful"), "expected the denial reason, got: " + message);
    }

    @Test
    @DisplayName("a denied tool reports back to the model while the others still run")
    void toolDeny() {
      assertEquals(expectedResult(vector("guardrail_tool_deny")), runForText("guardrail_tool_deny"));
    }

    @Test
    @DisplayName("guardrails that all pass leave the turn unchanged")
    void allPass() {
      assertEquals(expectedResult(vector("guardrail_all_pass")), runForText("guardrail_all_pass"));
    }

    @Test
    @DisplayName("a denied tool is never actually executed")
    void deniedToolDoesNotRun() {
      Map<String, Object> vector = vector("guardrail_tool_deny");
      registerMocks("guardrail_tool_deny", responses(vector));
      String key = mockKey("guardrail_tool_deny");

      AtomicInteger dangerous = new AtomicInteger();
      Map<String, ToolHandler> tools = new LinkedHashMap<>(toolHandlers(vector));
      tools.put(
          "dangerous_tool",
          arguments -> {
            dangerous.incrementAndGet();
            return "executed";
          });

      Pipeline.turn(
          buildAgent(vector, key), Map.of(), extensionOptions(vector, tools).build());

      assertEquals(0, dangerous.get(), "the denied tool should never have run");
    }
  }

  // =========================================================================
  // Steering
  // =========================================================================

  @Nested
  @DisplayName("steering")
  class SteeringVectors {

    /** The steering texts a vector queues, in the order it queues them. */
    private List<String> steeringTexts(Map<String, Object> vector) {
      List<String> result = new ArrayList<>();
      Map<String, Object> steering = asMap(input(vector).get("steering"));
      if (steering.get("messages") instanceof List<?> messages) {
        for (Object entry : messages) {
          result.add(String.valueOf(asMap(entry).get("text")));
        }
      }
      return result;
    }

    @Test
    @DisplayName("a queued message reaches the model on the next iteration")
    void injectMessage() {
      Map<String, Object> vector = vector("steering_inject_message");
      Run run = runVector("steering_inject_message", null, null);

      assertEquals(expectedResult(vector), run.result());
      assertSteeringDelivered(vector, run);
    }

    @Test
    @DisplayName("several queued messages are all delivered, in order")
    void multipleMessages() {
      Map<String, Object> vector = vector("steering_multiple_messages");
      Run run = runVector("steering_multiple_messages", null, null);

      assertEquals(expectedResult(vector), run.result());
      assertSteeringDelivered(vector, run);
    }

    /**
     * Check the steering actually reached the model rather than merely being accepted.
     *
     * <p>The vector annotates each message with the iteration it targets, but no runtime models
     * that: {@code Steering} is a plain queue that the policy drains whenever it next runs. So
     * what is checked here is delivery and ordering, which is the contract that exists, rather
     * than the iteration boundary, which is not.
     */
    private void assertSteeringDelivered(Map<String, Object> vector, Run run) {
      List<String> queued = steeringTexts(vector);
      assertFalse(queued.isEmpty(), "the vector queues no steering messages");

      List<String> delivered = texts(run.executor().received.get(0));
      int previous = -1;
      for (String text : queued) {
        int at = delivered.indexOf(text);
        assertTrue(at >= 0, "steering never delivered: '" + text + "' not in " + delivered);
        assertTrue(at > previous, "steering delivered out of order: '" + text + "' in " + delivered);
        previous = at;
      }
    }

    @Test
    @DisplayName("injected steering is announced to the caller")
    void announcesInjection() {
      List<String> events = new ArrayList<>();
      run("steering_inject_message", null, events);
      assertTrue(events.contains("status"), "expected a status event in " + events);
    }
  }

  // =========================================================================
  // Parallel tool calls
  // =========================================================================

  @Nested
  @DisplayName("parallel tool calls")
  class ParallelTools {

    /**
     * The vector's expected text names the Rust runtime because it was recorded there. Everything
     * else about the message is shared, so the runtime name is the one part that is dropped.
     */
    private String sharedExpectation(Map<String, Object> vector) {
      return ((String) expected(vector).get("rust_expected_error")).replace("Rust ", "");
    }

    @Test
    @DisplayName("requesting parallel tool calls is rejected as invalid")
    void basic() {
      Map<String, Object> vector = vector("parallel_tools_basic");
      InvokerException failure =
          assertThrows(InvokerException.class, () -> run("parallel_tools_basic"));

      assertEquals(InvokerException.Kind.VALIDATION, failure.kind());
      assertTrue(
          failure.getMessage().contains(sharedExpectation(vector)),
          "expected the shared rejection message, got: " + failure.getMessage());
    }

    @Test
    @DisplayName("the rejection happens before any other configuration is considered")
    void withGuardrailDeny() {
      Map<String, Object> vector = vector("parallel_tools_with_guardrail_deny");
      InvokerException failure =
          assertThrows(InvokerException.class, () -> run("parallel_tools_with_guardrail_deny"));

      assertEquals(InvokerException.Kind.VALIDATION, failure.kind());
      assertTrue(
          failure.getMessage().contains(sharedExpectation(vector)),
          "expected the shared rejection message, got: " + failure.getMessage());
    }

    @Test
    @DisplayName("a rejected turn still reports a start and an end")
    void reportsTerminalEvents() {
      List<String> events = new ArrayList<>();
      assertThrows(
          InvokerException.class, () -> run("parallel_tools_basic", null, events));
      assertEquals(List.of("turn_start", "error", "turn_end"), events);
    }
  }

  // =========================================================================
  // Coverage guard
  // =========================================================================

  @Test
  @DisplayName("every agent vector is exercised")
  void everyVectorIsCovered() {
    List<String> covered =
        List.of(
            "no_tool_calls",
            "single_tool_call",
            "multiple_tool_calls_single_turn",
            "multi_turn_tool_calls",
            "max_iterations_exceeded",
            "bindings_injected",
            "tool_not_registered_error",
            "tool_result_message_format",
            "assistant_tool_calls_metadata",
            "empty_tool_result",
            "async_tool_function",
            "events_basic_tool_loop",
            "events_no_tools",
            "events_error_logged",
            "cancellation_before_llm",
            "cancellation_between_tools",
            "cancellation_between_iterations",
            "context_trim_basic",
            "context_no_trim_when_fits",
            "context_preserves_system_messages",
            "guardrail_input_deny",
            "guardrail_output_deny",
            "guardrail_tool_deny",
            "guardrail_all_pass",
            "steering_inject_message",
            "steering_multiple_messages",
            "parallel_tools_basic",
            "parallel_tools_with_guardrail_deny");

    List<String> declared = new ArrayList<>();
    for (Map<String, Object> vector : VECTORS) {
      declared.add(String.valueOf(vector.get("name")));
    }

    List<String> missing = new ArrayList<>(declared);
    missing.removeAll(covered);
    assertTrue(missing.isEmpty(), "agent vectors with no test: " + missing);

    List<String> unknown = new ArrayList<>(covered);
    unknown.removeAll(declared);
    assertTrue(unknown.isEmpty(), "tests naming a vector that no longer exists: " + unknown);
  }
}

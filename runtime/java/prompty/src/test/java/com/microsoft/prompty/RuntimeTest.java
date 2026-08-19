package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.microsoft.prompty.model.ErrorChunk;
import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.Agent;
import com.microsoft.prompty.model.Role;
import com.microsoft.prompty.model.StreamChunk;
import com.microsoft.prompty.model.TextChunk;
import com.microsoft.prompty.model.TextPart;
import com.microsoft.prompty.model.ToolCall;
import com.microsoft.prompty.model.ToolChunk;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/**
 * Unit coverage for the runtime machinery the shared vectors do not reach.
 *
 * <p>The vectors describe the parts of Prompty that must agree across languages. Cancellation,
 * streaming accumulation, extension lookup, and structured-result transport are Java's own
 * concerns, so they are pinned down here.
 */
class RuntimeTest {

  /**
   * A name no real process supplies, used with {@link System#setProperty} to stand in for an ambient
   * value. Writing it as a property rather than reaching for a real variable such as {@code PATH}
   * keeps these tests deterministic on a machine started with an unusual environment.
   */
  private static final String AMBIENT = "PROMPTY_TEST_AMBIENT_VALUE";

  // ---------------------------------------------------------------- cancellation

  @Test
  void cancellationRunsCallbacksOnce() {
    CancellationToken token = CancellationToken.create();
    AtomicInteger calls = new AtomicInteger();
    token.onCancel(calls::incrementAndGet);

    assertFalse(token.isCancelled());
    token.cancel();
    token.cancel();

    assertTrue(token.isCancelled());
    assertEquals(1, calls.get(), "cancelling twice should not run callbacks twice");
  }

  @Test
  void cancellationRunsCallbacksRegisteredAfterTheFact() {
    CancellationToken token = CancellationToken.create();
    token.cancel();

    AtomicInteger calls = new AtomicInteger();
    token.onCancel(calls::incrementAndGet);

    assertEquals(1, calls.get(), "a callback registered after cancellation should still run");
  }

  @Test
  void cancellationRunsEveryCallbackEvenWhenOneFails() {
    CancellationToken token = CancellationToken.create();
    AtomicInteger calls = new AtomicInteger();
    token.onCancel(
        () -> {
          calls.incrementAndGet();
          throw new IllegalStateException("first callback failed");
        });
    token.onCancel(calls::incrementAndGet);

    assertThrows(IllegalStateException.class, token::cancel);
    assertEquals(2, calls.get(), "a failing callback should not strand the others");
  }

  @Test
  void uncancellableTokenIsShared() {
    assertSame(CancellationToken.none(), CancellationToken.none());
    assertFalse(CancellationToken.none().isCancelled());
    assertThrows(IllegalStateException.class, () -> CancellationToken.none().cancel());
  }

  @Test
  void cancelledTokenStopsIteration() {
    CancellationToken token = CancellationToken.create();
    Iterator<Integer> source = List.of(1, 2, 3).iterator();
    Iterator<Integer> guarded = Streams.cancellable(source, token);

    assertEquals(1, guarded.next());
    token.cancel();
    assertFalse(guarded.hasNext(), "a cancelled stream should stop yielding");
  }

  // ---------------------------------------------------------------- streaming

  @Test
  void consumeAccumulatesTextAndToolCalls() {
    ToolCall call = new ToolCall();
    call.id = "call_1";
    call.name = "get_weather";
    call.arguments = "{\"city\":\"Oslo\"}";

    Streams.Consumed consumed = Streams.consume(chunks(text("Hello "), text("world"), tool(call)), null);

    assertEquals("Hello world", consumed.text());
    assertEquals(1, consumed.toolCalls().size());
    assertEquals("get_weather", consumed.toolCalls().get(0).name);
  }

  @Test
  void consumeStopsAtAnErrorChunk() {
    ErrorChunk failure = new ErrorChunk();
    failure.message = "upstream went away";

    Streams.Consumed consumed = Streams.consume(chunks(text("partial"), failure, text("never")), null);

    assertEquals("partial", consumed.text(), "text after a failure should not be reported as if it arrived");
  }

  @Test
  void toolCallDeltasMergeByIndex() {
    List<Object> chunks =
        List.of(
            chunkWith(delta(0, "call_1", "get_weather", "{\"ci")),
            chunkWith(delta(0, null, null, "ty\":\"Oslo\"}")),
            chunkWith(delta(1, "call_2", "get_time", "{}")));

    List<ToolCall> merged = Streams.mergeToolCallDeltas(chunks);

    assertEquals(2, merged.size());
    assertEquals("call_1", merged.get(0).id);
    assertEquals("{\"city\":\"Oslo\"}", merged.get(0).arguments, "argument fragments should concatenate in order");
    assertEquals("get_time", merged.get(1).name);
  }

  // ---------------------------------------------------------------- registry

  @Test
  void unknownInvokerKeyNamesTheGroupAndKey() {
    Registry.bootstrap();
    InvokerException error = assertThrows(InvokerException.class, () -> Registry.executor("nonexistent"));

    assertEquals(InvokerException.Kind.NOT_FOUND, error.kind());
    assertTrue(error.getMessage().contains("nonexistent"), error.getMessage());
    assertTrue(error.getMessage().contains("executor"), error.getMessage());
  }

  @Test
  void builtInRenderersAndParserAreAvailable() {
    Registry.bootstrap();
    assertTrue(Registry.hasRenderer("jinja2"));
    assertTrue(Registry.hasRenderer("nunjucks"), "nunjucks is the spec's default format name");
    assertTrue(Registry.hasRenderer("mustache"));
    assertTrue(Registry.hasParser("prompty"));
  }

  // ---------------------------------------------------------------- environment

  @Test
  void explicitValuesOutrankTheAmbientEnvironment() {
    // A system property is the ambient layer that a test can actually control: the process
    // environment proper cannot be written from inside a JVM.
    System.setProperty(AMBIENT, "ambient");
    try {
      assertEquals("ambient", Environment.lookup(AMBIENT).orElseThrow());

      Environment.set(AMBIENT, "explicit");
      assertEquals("explicit", Environment.lookup(AMBIENT).orElseThrow());

      Environment.clear(AMBIENT);
      assertEquals(
          "ambient", Environment.lookup(AMBIENT).orElseThrow(), "clearing should restore the fallback");
    } finally {
      Environment.clear(AMBIENT);
      System.clearProperty(AMBIENT);
    }
  }

  @Test
  void maskingReportsANameAsUnsetEvenWhenTheProcessSuppliesIt() {
    // A JVM cannot unset its own environment, so the mask is the only way to express "absent".
    System.setProperty(AMBIENT, "ambient");
    try {
      assertTrue(Environment.lookup(AMBIENT).isPresent(), "the ambient value should be visible");

      Environment.mask(AMBIENT);
      assertTrue(Environment.lookup(AMBIENT).isEmpty(), "masking should hide the ambient value");

      Environment.clear(AMBIENT);
      assertTrue(Environment.lookup(AMBIENT).isPresent(), "clearing should restore the fallback");
    } finally {
      Environment.clear(AMBIENT);
      System.clearProperty(AMBIENT);
    }
  }

  @Test
  void maskingAlsoHidesAVariableInheritedFromTheProcess() {
    // The system-property case above cannot prove this one: only a real inherited variable
    // exercises the last link in the chain, which is the one a host actually wants to suppress.
    String inherited = System.getenv().keySet().stream().findFirst().orElse(null);
    assumeTrue(inherited != null, "the process was started with an empty environment");
    try {
      assertTrue(Environment.lookup(inherited).isPresent(), "the process supplies " + inherited);
      Environment.mask(inherited);
      assertTrue(Environment.lookup(inherited).isEmpty(), "masking should hide " + inherited);
    } finally {
      Environment.clear(inherited);
    }
    assertTrue(Environment.lookup(inherited).isPresent(), "clearing should restore the fallback");
  }

  @Test
  void anExplicitValueOutranksAMaskWhicheverOrderTheyArriveIn() {
    try {
      Environment.mask(AMBIENT);
      Environment.set(AMBIENT, "explicit");
      assertEquals(
          "explicit", Environment.lookup(AMBIENT).orElseThrow(), "setting a value should lift the mask");

      Environment.mask(AMBIENT);
      assertTrue(Environment.lookup(AMBIENT).isEmpty(), "masking should drop a value set earlier");
    } finally {
      Environment.clear(AMBIENT);
    }
  }

  @Test
  void clearAllLiftsMasksAsWellAsValues() {
    System.setProperty(AMBIENT, "ambient");
    try {
      Environment.mask(AMBIENT);
      assertTrue(Environment.lookup(AMBIENT).isEmpty());

      Environment.clearAll();
      assertTrue(Environment.lookup(AMBIENT).isPresent(), "clearAll should lift the mask too");
    } finally {
      Environment.clear(AMBIENT);
      System.clearProperty(AMBIENT);
    }
  }

  // ---------------------------------------------------------------- structured results

  @Test
  void structuredResultsSurviveTransport() {
    StructuredResult result = new StructuredResult(Map.of("city", "Oslo"), "{\"city\":\"Oslo\"}");
    Object transported = result.toTransport();

    assertTrue(StructuredResult.isWrapped(transported));
    StructuredResult restored = StructuredResult.fromTransport(transported);

    assertEquals(result.rawJson(), restored.rawJson());
    assertEquals(result.data(), restored.data());
    assertEquals(result.data(), StructuredResult.unwrap(transported));
  }

  @Test
  void plainResultsPassThroughUnwrapping() {
    assertEquals("just text", StructuredResult.unwrap("just text"));
    assertFalse(StructuredResult.isWrapped("just text"));
  }

  // ---------------------------------------------------------------- pipeline defaults

  @Test
  void pipelineFallsBackToTheSpecDefaults() {
    Agent agent = Agent.load(Map.of("kind", "prompt", "name", "t"), new LoadContext(null, null));

    assertEquals("nunjucks", Pipeline.formatKind(agent));
    assertEquals("prompty", Pipeline.parserKind(agent));
    assertEquals("openai", Pipeline.provider(agent));
    assertTrue(Pipeline.isStrict(agent), "injection defence should be on unless a prompt opts out");
    assertFalse(Pipeline.isStreaming(agent));
  }

  @Test
  void streamingIsReadFromModelOptions() {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("kind", "prompt");
    data.put("name", "t");
    data.put(
        "model",
        Map.of("id", "gpt-4", "options", Map.of("additionalProperties", Map.of("stream", true))));
    Agent agent = Agent.load(data, new LoadContext(null, null));

    assertTrue(Pipeline.isStreaming(agent));
  }

  @Test
  void missingRequiredInputNamesTheInput() {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("kind", "prompt");
    data.put("name", "t");
    data.put("inputs", List.of(Map.of("name", "city", "kind", "string", "required", true)));
    Agent agent = Agent.load(data, new LoadContext(null, null));

    InvokerException error = assertThrows(InvokerException.class, () -> Pipeline.validateInputs(agent, Map.of()));
    assertTrue(error.getMessage().contains("city"), error.getMessage());
  }

  // ---------------------------------------------------------------- messages

  @Test
  void messageHelpersReadAndWriteTextContent() {
    Message message = Messages.user("hello");

    assertEquals(Role.USER, message.role);
    assertEquals("hello", Messages.text(message));
    assertFalse(Messages.hasRichContent(message));
    assertEquals("hello", Messages.toTextContent(message));
  }

  @Test
  void richContentIsReportedAsParts() {
    Message message = new Message();
    message.role = Role.USER;
    message.parts = new ArrayList<>(List.of(Messages.textPart("look at this"), Messages.imagePart("https://x/y.png", null, null)));

    assertTrue(Messages.hasRichContent(message));
    assertTrue(Messages.toTextContent(message) instanceof List<?>, "rich content cannot collapse to a string");
  }

  @Test
  void toolResultsCarryTheirCallId() {
    Message message = Messages.toolResult("call_1", "sunny");

    assertEquals(Role.TOOL, message.role);
    assertEquals("call_1", Messages.metadata(message).get(Messages.TOOL_CALL_ID));
    assertEquals("sunny", Messages.text(message));
  }

  // ---------------------------------------------------------------- helpers

  private static Iterator<StreamChunk> chunks(StreamChunk... items) {
    return List.of(items).iterator();
  }

  private static TextChunk text(String value) {
    TextChunk chunk = new TextChunk();
    chunk.value = value;
    return chunk;
  }

  private static ToolChunk tool(ToolCall call) {
    ToolChunk chunk = new ToolChunk();
    chunk.toolCall = call;
    return chunk;
  }

  private static Map<String, Object> delta(int index, String id, String name, String arguments) {
    Map<String, Object> function = new LinkedHashMap<>();
    if (name != null) {
      function.put("name", name);
    }
    function.put("arguments", arguments);

    Map<String, Object> delta = new LinkedHashMap<>();
    delta.put("index", index);
    if (id != null) {
      delta.put("id", id);
    }
    delta.put("function", function);
    return delta;
  }

  /** Wrap a tool-call delta in the streaming envelope a provider sends it in. */
  private static Map<String, Object> chunkWith(Map<String, Object> toolCallDelta) {
    return Map.of("choices", List.of(Map.of("delta", Map.of("tool_calls", List.of(toolCallDelta)))));
  }

  /** Keeps the unused-import checker honest about what a text part looks like. */
  @Test
  void textPartsCarryTheirValue() {
    TextPart part = Messages.textPart("body");
    assertEquals("body", part.value);
  }

  // ------------------------------------------------------------- rich inputs

  @Test
  void onlyThreadInputsAreMarkedForParseTimeExpansion() {
    Agent agent = agentWithInputs(Map.of("history", "thread", "photo", "image"));

    Nonces.Prepared prepared = Nonces.prepareRenderInputs(agent, Map.of());

    assertEquals(
        Set.of("history", "photo"), prepared.nonces().keySet(), "every rich kind gets a marker");
    assertEquals(
        Set.of("history"),
        prepared.threadNonces().keySet(),
        "image, file and audio markers are resolved during wire conversion, not during parsing");
  }

  @Test
  void nonThreadMarkersSurviveExpansion() {
    Agent agent = agentWithInputs(Map.of("photo", "image"));
    Nonces.Prepared prepared = Nonces.prepareRenderInputs(agent, Map.of());
    String marker = prepared.nonces().get("photo");
    List<Message> messages = List.of(Messages.withText(Role.USER, "Look at " + marker));

    List<Message> expanded = Threads.expand(messages, prepared.threadNonces(), Map.of());

    assertEquals(1, expanded.size());
    assertTrue(
        ((TextPart) expanded.get(0).parts.get(0)).value.contains(marker),
        "an image marker must reach the wire layer intact, not be swallowed as empty history");
  }

  // ------------------------------------------------------- turn-engine contract

  @Test
  void toolCallRoundsRecordAnAssistantMessage() {
    Processor processor = (agent, response) -> response;
    Agent agent = agentWithInputs(Map.of());
    Object output = List.of(Map.of("id", "call_1", "name", "get_weather", "arguments", "{\"city\":\"Oslo\"}"));

    ModelInvocationResponse result =
        processor.processWithContext(agent, output, new ModelInvocationRequest());

    assertEquals(1, result.toolRequests.size());
    assertEquals(
        1,
        result.assistantMessages.size(),
        "the turn the model took has to appear in the next request's conversation");
    Message assistant = result.assistantMessages.get(0);
    assertEquals(Role.ASSISTANT, assistant.role);
    assertTrue(Messages.metadata(assistant).get("tool_calls") instanceof List<?>);
  }

  @Test
  void plainTextRoundsRecordTheAssistantText() {
    Processor processor = (agent, response) -> response;

    ModelInvocationResponse result =
        processor.processWithContext(agentWithInputs(Map.of()), "hello", new ModelInvocationRequest());

    assertEquals(1, result.assistantMessages.size());
    assertEquals("hello", Messages.text(result.assistantMessages.get(0)));
    assertTrue(result.toolRequests.isEmpty());
  }

  private static Agent agentWithInputs(Map<String, String> kindsByName) {
    List<Object> inputs = new ArrayList<>();
    kindsByName.forEach((name, kind) -> inputs.add(Map.of("name", name, "kind", kind)));
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("kind", "prompt");
    data.put("name", "t");
    data.put("model", "gpt-4");
    data.put("inputs", inputs);
    return Agent.load(data, new LoadContext(null, null));
  }
}

package com.microsoft.prompty.openai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.Messages;
import com.microsoft.prompty.StreamFailure;
import com.microsoft.prompty.model.ErrorChunk;
import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Agent;
import com.microsoft.prompty.model.Role;
import com.microsoft.prompty.model.StreamChunk;
import com.microsoft.prompty.model.TextChunk;
import com.microsoft.prompty.model.ToolCall;
import com.microsoft.prompty.model.ToolChunk;
import com.microsoft.prompty.model.UsageChunk;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Behaviour the shared vectors do not reach: streaming assembly and tool-turn replay.
 *
 * <p>Both are stateful across many wire events, so they cannot be expressed as a single
 * request/response fixture, yet both decide whether a multi-turn conversation works at all.
 */
class OpenAIStreamingTest {

  private static Agent agent() {
    return Agent.load(
        Map.of(
            "name", "test",
            "kind", "prompt",
            "instructions", "test",
            "model", Map.of("id", "gpt-4", "provider", "openai")),
        new LoadContext());
  }

  private static List<StreamChunk> drain(List<Object> chunks) {
    Iterator<StreamChunk> processed =
        new OpenAIProcessor().processStream(agent(), chunks.iterator());
    List<StreamChunk> result = new ArrayList<>();
    processed.forEachRemaining(result::add);
    return result;
  }

  private static Object chatDelta(Object delta) {
    return Map.of("choices", List.of(Map.of("delta", delta)));
  }

  @Test
  void textDeltasSurfaceInOrder() {
    List<StreamChunk> chunks =
        drain(
            List.of(
                chatDelta(Map.of("content", "Hello")),
                chatDelta(Map.of("content", " ")),
                chatDelta(Map.of("content", "world"))));

    assertEquals(3, chunks.size());
    assertEquals(
        "Hello world",
        chunks.stream()
            .map(c -> assertInstanceOf(TextChunk.class, c).value)
            .reduce("", String::concat));
  }

  @Test
  void toolCallDeltasAreAssembledAndEmittedInWireOrder() {
    List<StreamChunk> chunks =
        drain(
            List.of(
                // Deliberately interleaved and out of index order, as real streams arrive.
                chatDelta(
                    Map.of(
                        "tool_calls",
                        List.of(
                            Map.of(
                                "index", 1,
                                "id", "call_b",
                                "function", Map.of("name", "second", "arguments", "{\"x\""))))),
                chatDelta(
                    Map.of(
                        "tool_calls",
                        List.of(
                            Map.of(
                                "index", 0,
                                "id", "call_a",
                                "function", Map.of("name", "first", "arguments", "{}"))))),
                chatDelta(
                    Map.of(
                        "tool_calls",
                        List.of(Map.of("index", 1, "function", Map.of("arguments", ":1}"))))),
                Map.of("usage", Map.of("prompt_tokens", 10, "completion_tokens", 5))));

    List<ToolCall> calls =
        chunks.stream()
            .filter(ToolChunk.class::isInstance)
            .map(c -> ((ToolChunk) c).toolCall)
            .toList();

    assertEquals(2, calls.size());
    assertEquals("call_a", calls.get(0).id);
    assertEquals("first", calls.get(0).name);
    assertEquals("call_b", calls.get(1).id);
    // Fragments arriving across chunks must concatenate into valid JSON.
    assertEquals("{\"x\":1}", calls.get(1).arguments);

    UsageChunk usage =
        (UsageChunk) chunks.stream().filter(UsageChunk.class::isInstance).findFirst().orElseThrow();
    assertEquals(Long.valueOf(10), usage.usage.inputTokens);
    assertEquals(Long.valueOf(15), usage.usage.totalTokens);
  }

  @Test
  void refusalEndsTheStreamRatherThanContinuing() {
    List<StreamChunk> chunks =
        drain(
            List.of(
                chatDelta(Map.of("content", "thinking")),
                chatDelta(Map.of("refusal", "I cannot help with that")),
                // Anything after a refusal must not be surfaced.
                chatDelta(Map.of("content", "leaked"))));

    ErrorChunk error =
        (ErrorChunk) chunks.stream().filter(ErrorChunk.class::isInstance).findFirst().orElseThrow();
    assertTrue(error.message.contains("I cannot help with that"));
    assertFalse(
        chunks.stream()
            .anyMatch(c -> c instanceof TextChunk text && "leaked".equals(text.value)));
  }

  @Test
  void transportErrorsAreIndeterminateWhileProtocolErrorsAreNot() {
    List<StreamChunk> transport =
        drain(List.of(Map.of("error", Map.of("type", "sse_transport_error", "message", "reset"))));
    List<StreamChunk> protocol =
        drain(List.of(Map.of("error", Map.of("type", "invalid_request", "message", "bad"))));

    // A connection that dropped mid-stream may or may not have been acted on upstream, so a retry
    // is unsafe; a rejected request definitively did nothing and can be retried.
    assertTrue(StreamFailure.isIndeterminate(transport.get(0)));
    assertFalse(StreamFailure.isIndeterminate(protocol.get(0)));
  }

  @Test
  void responsesEventsAssembleFunctionCalls() {
    List<StreamChunk> chunks =
        drain(
            List.of(
                Map.of(
                    "type", "response.output_item.added",
                    "output_index", 0,
                    "item",
                        Map.of("type", "function_call", "id", "fc_1", "call_id", "call_1", "name",
                            "get_weather")),
                // The live API identifies argument events by item id, not call id.
                Map.of(
                    "type", "response.function_call_arguments.delta",
                    "item_id", "fc_1",
                    "output_index", 0,
                    "delta", "{\"city\":"),
                Map.of(
                    "type", "response.function_call_arguments.done",
                    "item_id", "fc_1",
                    "output_index", 0,
                    "arguments", "{\"city\":\"Seattle\"}")));

    ToolCall call =
        chunks.stream()
            .filter(ToolChunk.class::isInstance)
            .map(c -> ((ToolChunk) c).toolCall)
            .findFirst()
            .orElseThrow();

    assertEquals("get_weather", call.name);
    assertEquals("call_1", call.id);
    // `.done` carries the authoritative arguments and replaces whatever the deltas accumulated.
    assertEquals("{\"city\":\"Seattle\"}", call.arguments);
  }

  @Test
  void responsesArgumentEventsRouteByCallIdItemIdOrIndex() {
    // Providers label these events inconsistently. Whichever identifier is present must work, or
    // the tool call arrives with empty arguments and the turn fails for no visible reason.
    List<Object> added =
        List.of(
            Map.of(
                "type", "response.output_item.added",
                "output_index", 0,
                "item",
                    Map.of("type", "function_call", "id", "fc_1", "call_id", "call_1", "name", "f")));

    for (Map<String, Object> identifier :
        List.<Map<String, Object>>of(
            Map.of("call_id", "call_1"),
            Map.of("item_id", "fc_1"),
            Map.of("output_index", 0))) {
      Map<String, Object> event = new java.util.LinkedHashMap<>(identifier);
      event.put("type", "response.function_call_arguments.done");
      event.put("arguments", "{\"ok\":true}");

      List<Object> stream = new ArrayList<>(added);
      stream.add(event);

      ToolCall call =
          drain(stream).stream()
              .filter(ToolChunk.class::isInstance)
              .map(c -> ((ToolChunk) c).toolCall)
              .findFirst()
              .orElseThrow();
      assertEquals("{\"ok\":true}", call.arguments, "routed by " + identifier.keySet());
    }
  }

  @Test
  void toolResultsReplayAsAnAssistantCallFollowedByToolMessages() {
    ToolCall call = new ToolCall();
    call.id = "call_1";
    call.name = "get_weather";
    call.arguments = "{\"city\":\"Seattle\"}";

    List<Message> replay =
        new OpenAIExecutor()
            .formatToolMessages(
                Map.of("choices", List.of(Map.of("message", Map.of()))),
                List.of(call),
                List.of("72F"),
                "");

    assertEquals(2, replay.size());
    assertEquals(Role.ASSISTANT, replay.get(0).role);
    assertNotNull(Messages.metadata(replay.get(0)).get("tool_calls"));

    // The result must carry the id the model asked with, or the next turn cannot correlate it.
    assertEquals(Role.TOOL, replay.get(1).role);
    assertEquals("call_1", Messages.metadata(replay.get(1)).get(Messages.TOOL_CALL_ID));
    assertEquals("get_weather", Messages.metadata(replay.get(1)).get("name"));
    assertEquals("72F", Messages.text(replay.get(1)));
  }

  @Test
  void everyToolCallGetsAnAnswerEvenWhenOneIsMissing() {
    ToolCall first = new ToolCall();
    first.id = "call_1";
    first.name = "a";
    ToolCall second = new ToolCall();
    second.id = "call_2";
    second.name = "b";

    List<Message> replay =
        new OpenAIExecutor()
            .formatToolMessages(
                Map.of("choices", List.of(Map.of("message", Map.of()))),
                List.of(first, second),
                List.of("only one result"),
                "");

    // OpenAI rejects a conversation where a requested call has no answer, so a short results list
    // must still produce a message per call rather than silently dropping the tail.
    assertEquals(3, replay.size());
    assertEquals("call_2", Messages.metadata(replay.get(2)).get(Messages.TOOL_CALL_ID));
  }

  @Test
  void terminatingEarlyReleasesTheUnderlyingStream() {
    // A refusal ends the exchange while the provider is still sending; the connection has to be
    // released rather than left open waiting for content nobody may act on.
    CloseTrackingIterator source =
        new CloseTrackingIterator(
            List.of(
                    chatDelta(Map.of("refusal", "no")),
                    chatDelta(Map.of("content", "never read")))
                .iterator());

    Iterator<StreamChunk> processed = new OpenAIProcessor().processStream(agent(), source);
    processed.forEachRemaining(chunk -> {});

    assertTrue(source.closed, "a terminated stream must release its source");
  }

  /** An iterator that records whether it was closed, standing in for a live connection. */
  private static final class CloseTrackingIterator implements Iterator<Object>, java.io.Closeable {
    private final Iterator<Object> delegate;
    boolean closed;

    CloseTrackingIterator(Iterator<Object> delegate) {
      this.delegate = delegate;
    }

    @Override
    public boolean hasNext() {
      return delegate.hasNext();
    }

    @Override
    public Object next() {
      return delegate.next();
    }

    @Override
    public void close() {
      closed = true;
    }
  }
}

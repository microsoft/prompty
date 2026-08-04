package com.microsoft.prompty.anthropic;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.Messages;
import com.microsoft.prompty.model.ErrorChunk;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.StreamChunk;
import com.microsoft.prompty.model.TextChunk;
import com.microsoft.prompty.model.ThinkingChunk;
import com.microsoft.prompty.model.ToolCall;
import com.microsoft.prompty.model.ToolChunk;
import com.microsoft.prompty.model.UsageChunk;
import java.io.Closeable;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Covers the Anthropic streaming path, which no spec vector reaches.
 *
 * <p>A streamed response arrives as a sequence of partial events that only mean something in
 * aggregate, so the behaviour worth pinning down is how those fragments are assembled: what is
 * forwarded immediately, what is held back until the stream ends, and what happens when the stream
 * ends badly.
 */
class AnthropicStreamingTest {

  private static Map<String, Object> event(String type, Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    map.put("type", type);
    for (int i = 0; i + 1 < pairs.length; i += 2) {
      map.put(String.valueOf(pairs[i]), pairs[i + 1]);
    }
    return map;
  }

  private static List<StreamChunk> drain(List<Object> events) {
    Iterator<StreamChunk> chunks =
        new AnthropicProcessor().processStream(null, new ArrayList<>(events).iterator());
    List<StreamChunk> collected = new ArrayList<>();
    while (chunks.hasNext()) {
      collected.add(chunks.next());
    }
    return collected;
  }

  @Test
  void textDeltasAreForwardedAsTheyArrive() {
    List<StreamChunk> chunks =
        drain(
            List.of(
                event("content_block_delta", "index", 0, "delta", event("text_delta", "text", "He")),
                event(
                    "content_block_delta", "index", 0, "delta", event("text_delta", "text", "llo"))));

    assertEquals(2, chunks.size());
    assertEquals("He", assertInstanceOf(TextChunk.class, chunks.get(0)).value);
    assertEquals("llo", assertInstanceOf(TextChunk.class, chunks.get(1)).value);
  }

  @Test
  void thinkingDeltasAreForwardedSeparatelyFromText() {
    List<StreamChunk> chunks =
        drain(
            List.of(
                event(
                    "content_block_delta",
                    "index",
                    0,
                    "delta",
                    event("thinking_delta", "thinking", "hmm")),
                event(
                    "content_block_delta", "index", 1, "delta", event("text_delta", "text", "done"))));

    assertEquals("hmm", assertInstanceOf(ThinkingChunk.class, chunks.get(0)).value);
    assertEquals("done", assertInstanceOf(TextChunk.class, chunks.get(1)).value);
  }

  @Test
  void toolArgumentsAccumulateAcrossDeltasAndEmitOnceComplete() {
    List<StreamChunk> chunks =
        drain(
            List.of(
                event(
                    "content_block_start",
                    "index",
                    0,
                    "content_block",
                    event("tool_use", "id", "toolu_1", "name", "get_weather")),
                event(
                    "content_block_delta",
                    "index",
                    0,
                    "delta",
                    event("input_json_delta", "partial_json", "{\"city\":")),
                event(
                    "content_block_delta",
                    "index",
                    0,
                    "delta",
                    event("input_json_delta", "partial_json", "\"Paris\"}"))));

    // Nothing is emitted while the arguments are still arriving: a half-parsed tool call is not
    // something a caller can act on, so the call surfaces only once it is whole.
    List<ToolChunk> tools = new ArrayList<>();
    for (StreamChunk chunk : chunks) {
      if (chunk instanceof ToolChunk tool) {
        tools.add(tool);
      }
    }
    assertEquals(1, tools.size());
    ToolCall call = tools.get(0).toolCall;
    assertEquals("toolu_1", call.id);
    assertEquals("get_weather", call.name);
    assertEquals("{\"city\":\"Paris\"}", call.arguments);
  }

  @Test
  void usageFromBothEndsOfTheStreamIsCombinedIntoOneFinalChunk() {
    List<StreamChunk> chunks =
        drain(
            List.of(
                event("message_start", "message", event("message", "usage", Map.of("input_tokens", 10))),
                event("content_block_delta", "index", 0, "delta", event("text_delta", "text", "hi")),
                event("message_delta", "usage", Map.of("output_tokens", 5))));

    UsageChunk usage = assertInstanceOf(UsageChunk.class, chunks.get(chunks.size() - 1));
    assertEquals(Long.valueOf(10), usage.usage.inputTokens);
    assertEquals(Long.valueOf(5), usage.usage.outputTokens);
    assertEquals(Long.valueOf(15), usage.usage.totalTokens);
  }

  @Test
  void anErrorEventEndsTheStream() {
    List<StreamChunk> chunks =
        drain(
            List.of(
                event("content_block_delta", "index", 0, "delta", event("text_delta", "text", "hi")),
                event("error", "error", Map.of("message", "overloaded")),
                event("content_block_delta", "index", 0, "delta", event("text_delta", "text", "no"))));

    assertEquals(2, chunks.size());
    ErrorChunk error = assertInstanceOf(ErrorChunk.class, chunks.get(1));
    assertTrue(error.message.contains("overloaded"));
  }

  @Test
  void terminatingOnErrorReleasesTheUnderlyingStream() {
    CloseTrackingIterator source =
        new CloseTrackingIterator(
            List.of(
                event("error", "error", Map.of("message", "overloaded")),
                event("content_block_delta", "index", 0, "delta", event("text_delta", "text", "no"))));

    Iterator<StreamChunk> chunks = new AnthropicProcessor().processStream(null, source);
    while (chunks.hasNext()) {
      chunks.next();
    }

    // An abandoned HTTP response holds a connection open until something closes it, and an error
    // is exactly the case where nobody is going to read the rest.
    assertTrue(source.closed, "the transport should be closed once the stream terminates");
  }

  @Test
  void streamedBlocksAreRebuiltSoAToolRoundCanContinue() {
    List<Object> events =
        List.of(
            event(
                "content_block_start",
                "index",
                0,
                "content_block",
                event("thinking", "thinking", "", "signature", "")),
            event(
                "content_block_delta",
                "index",
                0,
                "delta",
                event("thinking_delta", "thinking", "weighing options")),
            event(
                "content_block_delta",
                "index",
                0,
                "delta",
                event("signature_delta", "signature", "sig-abc")),
            event(
                "content_block_start",
                "index",
                1,
                "content_block",
                event("tool_use", "id", "toolu_1", "name", "get_weather")),
            event(
                "content_block_delta",
                "index",
                1,
                "delta",
                event("input_json_delta", "partial_json", "{\"city\":\"Paris\"}")));

    ToolCall call = new ToolCall();
    call.id = "toolu_1";
    call.name = "get_weather";
    call.arguments = "{\"city\":\"Paris\"}";

    List<Message> messages =
        Wire.formatStreamToolMessages(events, List.of(call), List.of("sunny"), "");

    assertEquals(2, messages.size());
    Object blocks = Messages.metadata(messages.get(0)).get("content");
    List<?> content = assertInstanceOf(List.class, blocks);
    assertEquals(2, content.size());

    // The thinking block must come back with its signature intact, or Anthropic rejects the replay.
    Map<?, ?> thinking = assertInstanceOf(Map.class, content.get(0));
    assertEquals("thinking", thinking.get("type"));
    assertEquals("weighing options", thinking.get("thinking"));
    assertEquals("sig-abc", thinking.get("signature"));

    Map<?, ?> use = assertInstanceOf(Map.class, content.get(1));
    assertEquals("tool_use", use.get("type"));
    assertEquals(Map.of("city", "Paris"), use.get("input"));

    Object results = Messages.metadata(messages.get(1)).get("tool_results");
    List<?> resultBlocks = assertInstanceOf(List.class, results);
    assertEquals(1, resultBlocks.size());
    assertEquals("sunny", assertInstanceOf(Map.class, resultBlocks.get(0)).get("content"));
  }

  @Test
  void aReplayedStreamWithNoRawEventsIsRebuiltFromWhatWasAccumulated() {
    ToolCall call = new ToolCall();
    call.id = "toolu_1";
    call.name = "get_weather";
    call.arguments = "{\"city\":\"Paris\"}";

    List<Message> messages =
        Wire.formatStreamToolMessages(List.of(), List.of(call), List.of("sunny"), "Let me check.");

    List<?> content = assertInstanceOf(List.class, Messages.metadata(messages.get(0)).get("content"));
    assertEquals(2, content.size());
    assertEquals("Let me check.", assertInstanceOf(Map.class, content.get(0)).get("text"));
    assertEquals("tool_use", assertInstanceOf(Map.class, content.get(1)).get("type"));
  }

  @Test
  void everyToolCallGetsAnAnswerEvenWhenOneIsMissing() {
    ToolCall first = new ToolCall();
    first.id = "toolu_1";
    first.name = "a";
    ToolCall second = new ToolCall();
    second.id = "toolu_2";
    second.name = "b";

    List<Message> messages =
        Wire.formatToolMessages(
            Map.of("content", List.of()), List.of(first, second), List.of("only one"));

    // Anthropic rejects a conversation containing a tool_use with no matching tool_result, so a
    // short result list is padded rather than truncating the calls it fails to cover.
    List<?> results =
        assertInstanceOf(List.class, Messages.metadata(messages.get(1)).get("tool_results"));
    assertEquals(2, results.size());
    assertEquals("toolu_2", assertInstanceOf(Map.class, results.get(1)).get("tool_use_id"));
    assertEquals("", assertInstanceOf(Map.class, results.get(1)).get("content"));
  }

  /** An iterator that records whether the consumer closed it. */
  private static final class CloseTrackingIterator implements Iterator<Object>, Closeable {
    private final Iterator<Object> delegate;
    boolean closed;

    CloseTrackingIterator(List<Object> events) {
      this.delegate = new ArrayList<>(events).iterator();
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

  @Test
  void anEmptyStreamProducesNothingRatherThanAnEmptyTurn() {
    assertFalse(drain(List.of()).iterator().hasNext());
  }
}

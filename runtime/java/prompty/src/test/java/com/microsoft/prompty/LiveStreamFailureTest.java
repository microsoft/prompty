package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.StreamChunk;
import com.microsoft.prompty.model.TextChunk;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Covers how a streaming response that dies part-way through is reported.
 *
 * <p>A stream can fail in two very different ways. Either the provider definitively rejected the
 * request, or the connection dropped after the request was accepted and nobody knows whether it ran.
 * The second case is the dangerous one: the model may already have answered and its tools may
 * already have fired, so retrying would repeat the work and the charge. The turn has to carry that
 * distinction out to the engine, which is the only thing that can decide between retrying and
 * reconciling.
 */
class LiveStreamFailureTest {

  private static final String PROVIDER = "streamfailuretest";

  /** Opens a stream of one text chunk followed by whatever failure the test wants. */
  private static final class ScriptedExecutor implements Executor {
    private int opened;

    @Override
    public Object execute(Prompty agent, List<Message> messages) {
      throw new AssertionError("the turn should have streamed rather than called execute");
    }

    @Override
    public Iterator<Object> executeStream(Prompty agent, List<Message> messages) {
      opened++;
      return List.<Object>of("chunk").iterator();
    }
  }

  /** Turns the executor's placeholder chunk into a text chunk, then the scripted failure. */
  private record ScriptedProcessor(StreamFailure failure) implements Processor {
    @Override
    public Object process(Prompty agent, Object response) {
      return "";
    }

    @Override
    public Iterator<StreamChunk> processStream(Prompty agent, Iterator<Object> response) {
      List<StreamChunk> chunks = new ArrayList<>();
      TextChunk partial = new TextChunk();
      partial.value = "partial";
      chunks.add(partial);
      chunks.add(failure);
      return chunks.iterator();
    }
  }

  private static Prompty streamingAgent(String provider) {
    Map<String, Object> model = new LinkedHashMap<>();
    model.put("id", "test-model");
    model.put("provider", provider);
    model.put("options", Map.of("additionalProperties", Map.of("stream", true)));

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("kind", "prompt");
    data.put("name", "stream_failure_test");
    data.put("model", model);
    data.put("instructions", "system:\nYou are helpful.\n\nuser:\nHello.");
    data.put(
        "template", Map.of("format", Map.of("kind", "nunjucks"), "parser", Map.of("kind", "prompty")));
    return Prompty.load(data, new LoadContext());
  }

  /** A turn's outcome together with how many times the stream was actually opened. */
  private record Attempt(InvokerException failure, int opened) {}

  private static Attempt runWith(StreamFailure failure, String provider) {
    ScriptedExecutor executor = new ScriptedExecutor();
    Registry.registerExecutor(provider, executor);
    Registry.registerProcessor(provider, new ScriptedProcessor(failure));
    InvokerException thrown =
        assertThrows(
            InvokerException.class,
            () -> Pipeline.turn(streamingAgent(provider), Map.of(), TurnOptions.defaults()));
    return new Attempt(thrown, executor.opened);
  }

  @Test
  @DisplayName("a stream that fails with an unknown outcome is reported as indeterminate")
  void indeterminateStreamFailureKeepsItsKind() {
    Attempt attempt =
        runWith(StreamFailure.indeterminate("SSE stream error: connection reset"), PROVIDER + "_i");
    InvokerException failure = attempt.failure();

    assertEquals(
        InvokerException.Kind.EXECUTE_INDETERMINATE,
        failure.kind(),
        "expected an indeterminate failure, got " + failure.kind() + ": " + failure.getMessage());
    assertTrue(
        failure.getMessage().contains("connection reset"),
        "the provider's reason should survive: " + failure.getMessage());

    // The metadata is what a host needs to reconcile the effect against the provider.
    assertEquals(PROVIDER + "_i", failure.metadata().get("provider"));
    assertEquals("stream_transport", failure.metadata().get("phase"));

    // The consequence that matters: the request is never replayed. The model may already have
    // answered and its tools may already have fired, so a retry would repeat both.
    assertEquals(1, attempt.opened(), "an indeterminate stream failure must not be retried");
  }

  @Test
  @DisplayName("a stream that fails definitively is retried and then reported as exhausted")
  void determinateStreamFailureIsRetried() {
    Attempt attempt =
        runWith(StreamFailure.determinate("model rejected the request"), PROVIDER + "_d");
    InvokerException failure = attempt.failure();

    // A definite failure is safe to replay, so it takes the ordinary retry path instead.
    assertEquals(
        InvokerException.Kind.EXECUTE_RETRY_EXHAUSTED,
        failure.kind(),
        "expected retry exhaustion, got " + failure.kind() + ": " + failure.getMessage());
    assertTrue(
        failure.getMessage().contains("model rejected the request"),
        "the provider's reason should survive: " + failure.getMessage());
    assertTrue(
        attempt.opened() > 1,
        "a determinate stream failure should have been retried, opened " + attempt.opened());
  }
}

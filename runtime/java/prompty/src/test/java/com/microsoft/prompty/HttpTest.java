package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.io.Closeable;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Transport behaviour, exercised against a loopback server.
 *
 * <p>Mocking the client would only prove the mock behaves as written. The parts that actually break
 * in production — SSE framing, error classification, connection refusal — only show up when real
 * sockets are involved, so this uses a real one.
 */
class HttpTest {

  private HttpServer server;
  private String baseUrl;

  @BeforeEach
  void startServer() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.start();
    baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
  }

  @AfterEach
  void stopServer() {
    server.stop(0);
  }

  private void respond(String path, int status, String body) {
    server.createContext(
        path,
        exchange -> {
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(status, bytes.length);
          try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
          }
        });
  }

  private static List<Object> collect(Iterator<Object> stream) {
    List<Object> chunks = new ArrayList<>();
    stream.forEachRemaining(chunks::add);
    return chunks;
  }

  @Test
  void jsonResponsesAreParsed() {
    respond("/ok", 200, "{\"answer\":42}");

    Object response = Http.postJson("test", baseUrl + "/ok", Map.of(), Map.of("q", "life"));
    assertEquals(42L, ((Number) Streams.pointer(response, "answer")).longValue());
  }

  @Test
  void errorStatusesRaiseDeterminateFailures() {
    respond("/bad", 400, "{\"error\":{\"message\":\"nope\"}}");

    InvokerException error =
        assertThrows(
            InvokerException.class,
            () -> Http.postJson("test", baseUrl + "/bad", Map.of(), Map.of()));

    // The server rejected the request outright, so nothing happened and a retry is safe.
    assertEquals(InvokerException.Kind.EXECUTE, error.kind());
    assertTrue(error.getMessage().contains("nope"));
  }

  @Test
  void unreachableEndpointsRaiseDeterminateFailures() {
    // Port 1 on loopback refuses immediately: the request provably never reached a server.
    InvokerException error =
        assertThrows(
            InvokerException.class,
            () -> Http.postJson("test", "http://127.0.0.1:1/never", Map.of(), Map.of()));

    assertEquals(InvokerException.Kind.EXECUTE, error.kind());
  }

  @Test
  void serverSentEventsAreFramedIntoChunks() {
    respond(
        "/stream",
        200,
        """
        data: {"seq":1}

        data: {"seq":2}

        data: [DONE]

        """);

    List<Object> chunks = collect(Http.postSse("test", baseUrl + "/stream", Map.of(), Map.of()));

    // `[DONE]` is a terminator, not a chunk.
    assertEquals(2, chunks.size());
    assertEquals(1L, ((Number) Streams.pointer(chunks.get(0), "seq")).longValue());
    assertEquals(2L, ((Number) Streams.pointer(chunks.get(1), "seq")).longValue());
  }

  @Test
  void streamCommentsAndBlankLinesAreIgnored() {
    respond(
        "/comments",
        200,
        """
        : keep-alive

        event: ping

        data: {"seq":1}

        """);

    List<Object> chunks = collect(Http.postSse("test", baseUrl + "/comments", Map.of(), Map.of()));
    assertEquals(1, chunks.size());
  }

  @Test
  void unparseableStreamPayloadsSurfaceAsErrorChunksRatherThanThrowing() {
    respond("/broken", 200, "data: {not json}\n\n");

    List<Object> chunks = collect(Http.postSse("test", baseUrl + "/broken", Map.of(), Map.of()));

    // A caller mid-iteration cannot recover from an exception, so the failure travels in-band.
    assertEquals(1, chunks.size());
    assertEquals("sse_parse_error", Streams.pointer(chunks.get(0), "error", "type"));
  }

  @Test
  void streamErrorStatusesRaiseBeforeIteration() {
    respond("/denied", 401, "{\"error\":{\"message\":\"unauthorized\"}}");

    InvokerException error =
        assertThrows(
            InvokerException.class,
            () -> collect(Http.postSse("test", baseUrl + "/denied", Map.of(), Map.of())));
    assertFalse(error.getMessage().isEmpty());
  }

  @Test
  void abandonedStreamsCanBeClosedToReleaseTheConnection() {
    respond(
        "/long",
        200,
        """
        data: {"seq":1}

        data: {"seq":2}

        data: {"seq":3}

        """);

    Iterator<Object> stream = Http.postSse("test", baseUrl + "/long", Map.of(), Map.of());
    assertTrue(stream.hasNext());
    stream.next();

    // Java has no destructor, so a stream stopped early has to be closed explicitly or the
    // connection stays checked out of the pool until the collector eventually notices.
    assertInstanceOf(Closeable.class, stream);
    Streams.close(stream);

    // Reading past a closed stream must report exhaustion rather than blocking or throwing.
    assertFalse(stream.hasNext());
  }

  @Test
  void closingPropagatesThroughStreamWrappers() {
    respond("/wrapped", 200, "data: {\"seq\":1}\n\ndata: {\"seq\":2}\n\n");

    Iterator<Object> source = Http.postSse("test", baseUrl + "/wrapped", Map.of(), Map.of());
    CancellationToken token = new CancellationToken();
    Iterator<Object> wrapped = Streams.cancellable(Streams.peeking(source, chunk -> {}), token);

    assertTrue(wrapped.hasNext());
    wrapped.next();

    // The connection to release sits at the bottom of the chain, so closure has to travel down it.
    Streams.close(wrapped);
    assertFalse(source.hasNext());
  }

  @Test
  void cancellationReleasesTheUnderlyingStream() {
    respond("/cancel", 200, "data: {\"seq\":1}\n\ndata: {\"seq\":2}\n\n");

    Iterator<Object> source = Http.postSse("test", baseUrl + "/cancel", Map.of(), Map.of());
    CancellationToken token = new CancellationToken();
    Iterator<Object> stream = Streams.cancellable(source, token);

    assertTrue(stream.hasNext());
    stream.next();
    token.cancel();

    // Cancellation is a normal outcome, and the common one; leaking on it would exhaust the pool.
    assertFalse(stream.hasNext());
    assertFalse(source.hasNext());
  }
}

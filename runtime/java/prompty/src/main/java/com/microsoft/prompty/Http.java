package com.microsoft.prompty;

import com.microsoft.prompty.model.TypraJson;
import java.io.BufferedReader;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

/**
 * The HTTP transport every provider shares.
 *
 * <p>Providers differ in what they send, not in how it travels, so connection pooling, error
 * classification, and SSE framing live here once. Sharing them also means a fix to any of those —
 * particularly the determinate/indeterminate distinction below — reaches every provider at once.
 */
public final class Http {

  /**
   * One client for the process.
   *
   * <p>Each {@code HttpClient} owns a connection pool and a selector thread, so building one per
   * request would both defeat keep-alive and leak threads under load.
   */
  private static final HttpClient CLIENT =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build();

  private Http() {}

  /**
   * POST a JSON body and decode the JSON reply.
   *
   * @param provider the provider name, used only to attribute failures
   */
  public static Object postJson(
      String provider, String url, Map<String, String> headers, Object body) {
    HttpResponse<String> response =
        send(provider, url, headers, body, HttpResponse.BodyHandlers.ofString());
    checkStatus(provider, response.statusCode(), response.body());
    try {
      return TypraJson.parse(response.body());
    } catch (RuntimeException e) {
      // The provider accepted and acted on the request; only the reply was unreadable. Retrying
      // could duplicate whatever it already did, so the caller is told the outcome is unknown.
      throw InvokerException.indeterminateExecution(
          "Failed to parse " + provider + " response after provider dispatch: " + e.getMessage(),
          Map.of("provider", provider, "phase", "response_body"));
    }
  }

  /**
   * GET a URL and decode the JSON reply.
   *
   * <p>Unlike a POST, a read has no effect to duplicate, so every failure here is determinate: the
   * caller may retry freely.
   *
   * @param provider the provider name, used only to attribute failures
   */
  public static Object getJson(String provider, String url, Map<String, String> headers) {
    return getJson(provider, url, headers, null);
  }

  /**
   * As {@link #getJson(String, String, Map)}, with a bound on the whole exchange.
   *
   * <p>The client-level timeout only covers establishing the connection, so a server that accepts a
   * connection and then stalls holds the caller indefinitely. That is tolerable where the caller is
   * waiting on a model anyway, and not tolerable for control-plane calls made while a person waits
   * on a picker — hence a bound the caller chooses rather than one imposed on every read.
   *
   * @param timeout the limit on the complete exchange, or null for none
   */
  public static Object getJson(
      String provider, String url, Map<String, String> headers, Duration timeout) {
    HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url)).GET();
    headers.forEach(builder::header);
    if (timeout != null) {
      builder.timeout(timeout);
    }

    HttpResponse<String> response;
    try {
      response = CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    } catch (IOException e) {
      throw InvokerException.execute("HTTP request failed: " + e, e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw InvokerException.cancelled("Interrupted while calling " + provider);
    }

    checkStatus(provider, response.statusCode(), response.body());
    try {
      return TypraJson.parse(response.body());
    } catch (RuntimeException e) {
      throw InvokerException.execute(
          "Failed to parse " + provider + " response: " + e.getMessage(), e);
    }
  }

  /**
   * POST a JSON body and read the reply as a stream of server-sent events.
   *
   * <p>The returned iterator holds an open connection. It closes itself once the stream ends, but a
   * caller that abandons it early should close it — see {@link Streams#close}.
   */
  public static Iterator<Object> postSse(
      String provider, String url, Map<String, String> headers, Object body) {
    HttpResponse<InputStream> response =
        send(provider, url, headers, body, HttpResponse.BodyHandlers.ofInputStream());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      checkStatus(provider, response.statusCode(), readAll(response.body()));
    }
    return new SseIterator(response.body());
  }

  /**
   * POST a form-encoded body and return the raw status and body.
   *
   * <p>OAuth token endpoints speak {@code application/x-www-form-urlencoded} rather than JSON, and
   * unlike every other call here a non-success status is not necessarily a failure: the device-code
   * grant reports "the user has not finished signing in yet" as an HTTP error with a machine-readable
   * body. Deciding what a status means is therefore left to the caller, and this method throws only
   * when the exchange never completed at all.
   */
  public static FormResult postForm(String provider, String url, Map<String, String> form) {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create(url))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .timeout(Duration.ofSeconds(30))
            .POST(HttpRequest.BodyPublishers.ofString(encodeForm(form), StandardCharsets.UTF_8));

    try {
      HttpResponse<String> response = CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofString());
      return new FormResult(response.statusCode(), response.body() == null ? "" : response.body());
    } catch (IOException e) {
      throw classifyTransportFailure(provider, e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw InvokerException.cancelled("Interrupted while calling " + provider);
    }
  }

  /** The status and body of a form POST, before any interpretation. */
  public record FormResult(int status, String body) {

    /** Whether the status is in the 2xx range. */
    public boolean isSuccess() {
      return status >= 200 && status < 300;
    }
  }

  /**
   * Encode a map as {@code application/x-www-form-urlencoded}.
   *
   * <p>Public because the same encoding serves both a form body and a URL query string — OAuth needs
   * one of each, and they must agree on how a space is written.
   *
   * <p>{@link URLEncoder} writes a space as {@code +}, which is what this media type specifies and
   * what the Rust runtime's form serializer also emits — the two must agree, because a scope such as
   * {@code "https://ai.azure.com/.default offline_access"} contains one.
   */
  public static String encodeForm(Map<String, String> form) {
    StringBuilder encoded = new StringBuilder();
    for (Map.Entry<String, String> entry : form.entrySet()) {
      if (encoded.length() > 0) {
        encoded.append('&');
      }
      encoded
          .append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8))
          .append('=')
          .append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
    }
    return encoded.toString();
  }

  private static <T> HttpResponse<T> send(
      String provider,
      String url,
      Map<String, String> headers,
      Object body,
      HttpResponse.BodyHandler<T> handler) {
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create(url))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(TypraJson.stringify(body), StandardCharsets.UTF_8));
    headers.forEach(builder::header);

    try {
      return CLIENT.send(builder.build(), handler);
    } catch (IOException e) {
      throw classifyTransportFailure(provider, e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw InvokerException.cancelled("Interrupted while calling " + provider);
    }
  }

  /**
   * Decide whether a transport failure leaves the request's outcome knowable.
   *
   * <p>A connection that was never established is determinate: nothing reached the provider, so a
   * retry is safe. A failure after the request went out is not — the provider may have completed it
   * — and a blind retry could duplicate a tool call or a charge.
   */
  private static InvokerException classifyTransportFailure(String provider, IOException error) {
    String message = "HTTP request failed: " + error;
    // A connect timeout is as determinate as a refused connection: the request never left, so the
    // work is simply lost and retrying it cannot duplicate anything.
    if (error instanceof java.net.ConnectException
        || error instanceof java.net.UnknownHostException
        || error instanceof java.net.http.HttpConnectTimeoutException) {
      return InvokerException.execute(message, error);
    }
    return InvokerException.indeterminateExecution(
        message, Map.of("provider", provider, "phase", "request_dispatch"));
  }

  private static void checkStatus(String provider, int status, String body) {
    if (status < 200 || status >= 300) {
      throw InvokerException.execute(
          provider + " API error (HTTP " + status + "): " + (body == null ? "" : body));
    }
  }

  private static String readAll(InputStream stream) {
    try (InputStream input = stream) {
      return new String(input.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      return "unable to read body";
    }
  }

  /**
   * Frames a server-sent event stream into the JSON payloads it carries.
   *
   * <p>Failures are surfaced as {@code error} events in the stream rather than thrown, because a
   * stream that has already yielded chunks cannot un-yield them; the consumer needs to see what
   * arrived and then why it stopped.
   */
  private static final class SseIterator implements Iterator<Object>, Closeable {

    private final BufferedReader reader;
    private final List<Object> pending = new ArrayList<>();
    private boolean done;

    SseIterator(InputStream stream) {
      this.reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
    }

    @Override
    public boolean hasNext() {
      fill();
      return !pending.isEmpty();
    }

    @Override
    public Object next() {
      fill();
      if (pending.isEmpty()) {
        throw new NoSuchElementException();
      }
      return pending.remove(0);
    }

    private void fill() {
      while (pending.isEmpty() && !done) {
        String line;
        try {
          line = reader.readLine();
        } catch (IOException e) {
          pending.add(
              Map.of(
                  "error",
                  Map.of("type", "sse_transport_error", "message", "SSE stream error: " + e)));
          close();
          return;
        }

        if (line == null) {
          close();
          return;
        }
        if (!line.startsWith("data:")) {
          // Comments, event names, and the blank lines between events carry no payload.
          continue;
        }

        String data = line.substring("data:".length()).trim();
        if ("[DONE]".equals(data)) {
          close();
          return;
        }
        if (data.isEmpty()) {
          continue;
        }
        try {
          pending.add(TypraJson.parse(data));
        } catch (RuntimeException e) {
          pending.add(
              Map.of(
                  "error",
                  Map.of(
                      "type", "sse_parse_error",
                      "message", "Failed to parse SSE data: " + e.getMessage(),
                      "raw", data)));
        }
      }
    }

    @Override
    public void close() {
      done = true;
      try {
        reader.close();
      } catch (IOException e) {
        // The stream is already finished; a failure releasing it tells the caller nothing useful
        // and must not mask the chunks or the error already queued for them.
      }
    }
  }
}

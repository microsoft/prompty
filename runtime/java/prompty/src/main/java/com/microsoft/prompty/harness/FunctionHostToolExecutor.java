package com.microsoft.prompty.harness;

import com.microsoft.prompty.model.HostToolExecutor;
import com.microsoft.prompty.model.HostToolRequest;
import com.microsoft.prompty.model.HostToolResult;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.BiFunction;

/**
 * Dispatches host tool requests to registered local functions.
 *
 * <p>A handler that throws, and a tool name nobody registered, both come back as an unsuccessful
 * {@link HostToolResult} rather than an exception. That is deliberate: the model asked for
 * something and is owed an answer it can read and react to. Throwing would end the turn over a
 * failure the model could have recovered from, and would leave the tool call unanswered in the
 * conversation, which most providers reject outright on the next request.
 */
public final class FunctionHostToolExecutor implements HostToolExecutor {

  /** A tool implementation: arguments and the originating request in, a JSON-shaped result out. */
  public interface Handler extends BiFunction<Map<String, Object>, HostToolRequest, Object> {}

  private final Map<String, Handler> handlers;

  public FunctionHostToolExecutor() {
    this(Map.of());
  }

  public FunctionHostToolExecutor(Map<String, Handler> handlers) {
    this.handlers = Map.copyOf(handlers);
  }

  /** A copy of this executor with {@code handler} registered under {@code name}. */
  public FunctionHostToolExecutor with(String name, Handler handler) {
    Map<String, Handler> merged = new LinkedHashMap<>(handlers);
    merged.put(name, handler);
    return new FunctionHostToolExecutor(merged);
  }

  @Override
  public HostToolResult execute(HostToolRequest request) {
    long started = System.nanoTime();
    Handler handler = handlers.get(request.toolName);
    if (handler == null) {
      return failure(
          request,
          started,
          "not_found",
          "No host tool registered for '" + request.toolName + "'");
    }

    Map<String, Object> arguments = request.arguments == null ? Map.of() : request.arguments;
    try {
      Object result = handler.apply(arguments, request);
      HostToolResult success = base(request, started);
      success.success = true;
      success.result = result;
      return success;
    } catch (RuntimeException e) {
      String message = e.getMessage() == null ? e.toString() : e.getMessage();
      return failure(request, started, "exception", message);
    }
  }

  private static HostToolResult failure(
      HostToolRequest request, long started, String errorKind, String message) {
    HostToolResult result = base(request, started);
    result.success = false;
    result.result = new LinkedHashMap<>(Map.of("message", message));
    result.errorKind = errorKind;
    return result;
  }

  private static HostToolResult base(HostToolRequest request, long started) {
    HostToolResult result = new HostToolResult();
    result.requestId = request.requestId;
    result.toolCallId = request.toolCallId;
    result.toolName = request.toolName;
    result.durationMs = (System.nanoTime() - started) / 1_000_000.0;
    return result;
  }
}

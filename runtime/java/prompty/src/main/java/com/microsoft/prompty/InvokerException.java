package com.microsoft.prompty;

import java.util.List;
import java.util.Map;

/**
 * Raised by any of the four pipeline stages — render, parse, execute, process.
 *
 * <p>Mirrors the {@code InvokerError} enum in the Rust runtime. The variant is carried on {@link
 * #kind()} rather than encoded in a class hierarchy so the set stays closed and comparable across
 * runtimes.
 */
public class InvokerException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  /** The class of pipeline failure, mirroring the Rust {@code InvokerError} variants. */
  public enum Kind {
    /** No invoker was registered for the requested group and key. */
    NOT_FOUND,
    /** The renderer failed. */
    RENDER,
    /** The parser failed. */
    PARSE,
    /** The executor failed. */
    EXECUTE,
    /**
     * The provider request may already have been dispatched, so the outcome requires
     * reconciliation rather than a retry or a commit.
     */
    EXECUTE_INDETERMINATE,
    /** The processor failed. */
    PROCESS,
    /** Input validation failed. */
    VALIDATION,
    /** Loading a {@code .prompty} document failed. */
    LOAD,
    /** The operation was cancelled through its cancellation token. */
    CANCELLED,
    /** The agent loop exhausted its retries; accumulated conversation state is attached. */
    EXECUTE_RETRY_EXHAUSTED,
    /** Any other failure. */
    OTHER
  }

  private final Kind kind;
  private final Map<String, Object> metadata;
  private final List<com.microsoft.prompty.model.Message> messages;

  public InvokerException(Kind kind, String message) {
    this(kind, message, null, null, null);
  }

  public InvokerException(Kind kind, String message, Throwable cause) {
    this(kind, message, cause, null, null);
  }

  private InvokerException(
      Kind kind,
      String message,
      Throwable cause,
      Map<String, Object> metadata,
      List<com.microsoft.prompty.model.Message> messages) {
    super(message, cause);
    this.kind = kind;
    this.metadata = metadata;
    this.messages = messages;
  }

  public Kind kind() {
    return kind;
  }

  /**
   * Reconciliation metadata attached to an {@link Kind#EXECUTE_INDETERMINATE} failure. Empty for
   * every other variant.
   */
  public Map<String, Object> metadata() {
    return metadata == null ? Map.of() : metadata;
  }

  /**
   * Conversation accumulated before an {@link Kind#EXECUTE_RETRY_EXHAUSTED} failure, so a caller can
   * resume rather than restart. Empty for every other variant.
   */
  public List<com.microsoft.prompty.model.Message> messages() {
    return messages == null ? List.of() : messages;
  }

  public static InvokerException notFound(String group, String key) {
    return new InvokerException(
        Kind.NOT_FOUND, "no " + group + " registered for key '" + key + "'");
  }

  public static InvokerException render(String message) {
    return new InvokerException(Kind.RENDER, "render error: " + message);
  }

  public static InvokerException render(String message, Throwable cause) {
    return new InvokerException(Kind.RENDER, "render error: " + message, cause);
  }

  public static InvokerException parse(String message) {
    return new InvokerException(Kind.PARSE, "parse error: " + message);
  }

  public static InvokerException execute(String message) {
    return new InvokerException(Kind.EXECUTE, "execute error: " + message);
  }

  public static InvokerException execute(String message, Throwable cause) {
    return new InvokerException(Kind.EXECUTE, "execute error: " + message, cause);
  }

  /**
   * Mark an execution failure as requiring model-outcome reconciliation.
   *
   * <p>Executors should reach for this only once dispatch has become ambiguous. Configuration,
   * validation, and connection-establishment failures stay ordinary retryable {@link Kind#EXECUTE}
   * errors.
   */
  public static InvokerException indeterminateExecution(
      String message, Map<String, Object> metadata) {
    return new InvokerException(
        Kind.EXECUTE_INDETERMINATE, "indeterminate execution: " + message, null, metadata, null);
  }

  public static InvokerException process(String message) {
    return new InvokerException(Kind.PROCESS, "process error: " + message);
  }

  public static InvokerException process(String message, Throwable cause) {
    return new InvokerException(Kind.PROCESS, "process error: " + message, cause);
  }

  public static InvokerException validation(String message) {
    return new InvokerException(Kind.VALIDATION, "validation error: " + message);
  }

  public static InvokerException load(String message) {
    return new InvokerException(Kind.LOAD, "load error: " + message);
  }

  public static InvokerException cancelled(String message) {
    return new InvokerException(Kind.CANCELLED, "cancelled: " + message);
  }

  public static InvokerException retryExhausted(
      String message, List<com.microsoft.prompty.model.Message> messages) {
    return new InvokerException(
        Kind.EXECUTE_RETRY_EXHAUSTED, message, null, null, List.copyOf(messages));
  }

  public static InvokerException other(String message) {
    return new InvokerException(Kind.OTHER, message);
  }
}

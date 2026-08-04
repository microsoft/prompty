package com.microsoft.prompty.engine;

import java.util.Map;

/**
 * A failure reported by one of the effect ports the turn engine drives.
 *
 * <p>Two flags decide what the engine does next, and they mean very different things. {@link
 * #outcomeUnknown} says the effect may or may not have happened — a request that timed out after the
 * provider accepted it, say. The engine cannot retry that safely, because retrying might duplicate a
 * side effect it cannot see, so it stops and commits a turn that asks the host to reconcile. {@link
 * #configurationError} says the request itself is wrong, so no amount of retrying or model recovery
 * will help; the engine fails the turn immediately rather than feeding the error back to the model.
 *
 * <p>A plain failure is neither: the engine retries it up to the request's attempt budget, and, for
 * tools, hands the failure to the model as a tool result so it can adapt.
 */
public class PortException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  private final boolean outcomeUnknown;
  private final boolean configurationError;
  private final transient Map<String, Object> metadata;

  private PortException(
      String message,
      boolean outcomeUnknown,
      boolean configurationError,
      Map<String, Object> metadata,
      Throwable cause) {
    super(message, cause);
    this.outcomeUnknown = outcomeUnknown;
    this.configurationError = configurationError;
    this.metadata = metadata;
  }

  /** A retryable failure whose effect definitely did not occur. */
  public static PortException of(String message) {
    return new PortException(message, false, false, null, null);
  }

  /** A retryable failure whose effect definitely did not occur, wrapping a cause. */
  public static PortException of(String message, Throwable cause) {
    return new PortException(message, false, false, null, cause);
  }

  /** An effect that may have occurred, so the turn must stop and be reconciled by the host. */
  public static PortException indeterminate(String message) {
    return new PortException(message, true, false, null, null);
  }

  /** An indeterminate effect carrying provider-specific data the host needs to reconcile it. */
  public static PortException indeterminate(String message, Map<String, Object> metadata) {
    return new PortException(message, true, false, metadata, null);
  }

  /** A plan or binding error that neither a retry nor the model can recover from. */
  public static PortException configuration(String message) {
    return new PortException(message, false, true, null, null);
  }

  /** Whether the effect may have occurred, leaving the durable record ambiguous. */
  public boolean outcomeUnknown() {
    return outcomeUnknown;
  }

  /** Whether the request is malformed, making retries and model recovery pointless. */
  public boolean configurationError() {
    return configurationError;
  }

  /** Provider-specific reconciliation data, or null when the port supplied none. */
  public Map<String, Object> metadata() {
    return metadata;
  }
}

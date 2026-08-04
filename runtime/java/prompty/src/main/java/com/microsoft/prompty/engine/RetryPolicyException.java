package com.microsoft.prompty.engine;

/**
 * A failure raised while waiting out a retry backoff.
 *
 * <p>Cancellation during a backoff is not an error condition — the caller asked the turn to stop —
 * so it is modelled separately from a genuine backoff failure and commits a cancelled turn rather
 * than a failed one.
 */
public class RetryPolicyException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  private final boolean cancelled;

  private RetryPolicyException(String message, boolean cancelled, Throwable cause) {
    super(message, cause);
    this.cancelled = cancelled;
  }

  /** The backoff was interrupted because the turn was cancelled. */
  public static RetryPolicyException cancelled() {
    return new RetryPolicyException("retry backoff cancelled", true, null);
  }

  /** The backoff itself failed. */
  public static RetryPolicyException failed(PortException cause) {
    return new RetryPolicyException(cause.getMessage(), false, cause);
  }

  /** Whether the backoff ended because the turn was cancelled rather than because it failed. */
  public boolean isCancelled() {
    return cancelled;
  }
}

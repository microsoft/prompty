package com.microsoft.prompty.engine;

/**
 * A deterministic policy rejection raised by a {@link HostPolicyPort}.
 *
 * <p>Unlike a {@link PortException}, this is never retried. The host has made a decision — a
 * guardrail denied the input, an output failed validation — and the engine records that decision as
 * the turn's failure kind rather than treating it as a transient fault.
 */
public class HostPolicyException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  private final String errorKind;

  public HostPolicyException(String errorKind, String message) {
    super(message);
    this.errorKind = errorKind;
  }

  /** The stable identifier the engine commits as the turn's {@code errorKind}. */
  public String errorKind() {
    return errorKind;
  }
}

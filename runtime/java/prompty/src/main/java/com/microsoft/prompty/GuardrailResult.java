package com.microsoft.prompty;

/**
 * A guardrail's decision about one operation.
 *
 * <p>A guardrail may allow, deny with a reason, or allow while substituting a replacement value.
 * The rewrite is deliberately only honoured for output checks: rewriting an input or a tool
 * argument would silently change what the model was asked, whereas rewriting an output changes
 * only what the caller is told.
 */
public record GuardrailResult(boolean allowed, String reason, Object rewrite) {

  /** Allow the operation unchanged. */
  public static GuardrailResult allow() {
    return new GuardrailResult(true, null, null);
  }

  /** Deny the operation, recording why. */
  public static GuardrailResult deny(String reason) {
    return new GuardrailResult(false, reason, null);
  }

  /** Allow the operation, substituting {@code rewrite} for the value that was checked. */
  public static GuardrailResult rewrite(Object rewrite) {
    return new GuardrailResult(true, null, rewrite);
  }

  /** Whether this result carries a replacement value. */
  public boolean hasRewrite() {
    return rewrite != null;
  }

  /** The denial reason, or {@code fallback} when none was given. */
  public String reasonOr(String fallback) {
    return reason == null || reason.isEmpty() ? fallback : reason;
  }
}

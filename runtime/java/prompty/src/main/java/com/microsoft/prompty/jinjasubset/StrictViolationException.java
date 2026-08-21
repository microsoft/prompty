package com.microsoft.prompty.jinjasubset;

/** Raised when a strict interpolation forges a role boundary. */
public final class StrictViolationException extends RuntimeException {
  public StrictViolationException(String message) { super(message); }
}

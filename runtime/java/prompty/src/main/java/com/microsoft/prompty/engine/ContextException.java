package com.microsoft.prompty.engine;

/** A failure raised while assembling the context for a model invocation. */
public class ContextException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  private ContextException(String message, Throwable cause) {
    super(message, cause);
  }

  /** A source, transform, or packing strategy failed. */
  public static ContextException stage(String stage, String name, Throwable cause) {
    return new ContextException(
        stage + " '" + name + "' failed: " + (cause == null ? "" : cause.getMessage()), cause);
  }

  /** A packing strategy produced a snapshot that breaks a replay or portability invariant. */
  public static ContextException invalidSnapshot(String message) {
    return new ContextException("invalid context snapshot: " + message, null);
  }
}

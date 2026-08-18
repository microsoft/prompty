package com.microsoft.prompty;

import com.microsoft.prompty.model.ErrorChunk;

/**
 * An error chunk that also says whether the request's outcome is known.
 *
 * <p>A stream can fail in two materially different ways. A refusal or an API error is
 * <em>determinate</em>: the provider decided, nothing was applied, and retrying is safe. A transport
 * failure mid-stream is <em>indeterminate</em>: the request may have completed server-side, so a
 * blind retry can duplicate a tool call or a charge.
 *
 * <p>The generated {@code ErrorChunk} carries only a message, because the distinction is a runtime
 * concern rather than part of the portable schema. Extending it keeps that nuance available to
 * callers who need it while remaining an ordinary {@code ErrorChunk} to everyone else — including
 * serialization, which is inherited unchanged.
 */
public class StreamFailure extends ErrorChunk {

  /**
   * Whether the request may have taken effect despite the failure.
   *
   * <p>When true, the caller must reconcile before retrying rather than simply reissuing.
   */
  public boolean outcomeUnknown;

  public StreamFailure() {}

  /** A failure whose outcome is known: nothing was applied. */
  public static StreamFailure determinate(String message) {
    return create(message, false);
  }

  /** A failure whose outcome is unknown: the request may have completed server-side. */
  public static StreamFailure indeterminate(String message) {
    return create(message, true);
  }

  private static StreamFailure create(String message, boolean outcomeUnknown) {
    StreamFailure failure = new StreamFailure();
    failure.message = message == null ? "" : message;
    failure.outcomeUnknown = outcomeUnknown;
    return failure;
  }

  /** Whether a chunk reports a failure whose outcome is unknown. */
  public static boolean isIndeterminate(Object chunk) {
    return chunk instanceof StreamFailure failure && failure.outcomeUnknown;
  }
}

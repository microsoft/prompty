package com.microsoft.prompty;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A cooperative cancellation signal shared between a caller and a long-running provider call.
 *
 * <p>Cancellation is one-way and idempotent: once cancelled a token stays cancelled, and cancelling
 * again is a no-op. Registered callbacks fire exactly once, on the thread that calls {@link
 * #cancel()}, or immediately on the registering thread if the token is already cancelled.
 *
 * <p>A callback that throws does not prevent the remaining callbacks from running — cancellation
 * must not be derailed by a misbehaving listener — but the first such failure is rethrown once every
 * callback has been given its turn.
 */
public final class CancellationToken {

  private static final CancellationToken NONE = new CancellationToken();

  private final AtomicBoolean cancelled = new AtomicBoolean(false);
  private final List<Runnable> callbacks = new CopyOnWriteArrayList<>();

  /** A token that is never cancelled. Safe to share; registering on it does nothing. */
  public static CancellationToken none() {
    return NONE;
  }

  /** Create a fresh, uncancelled token. */
  public static CancellationToken create() {
    return new CancellationToken();
  }

  public boolean isCancelled() {
    return cancelled.get();
  }

  /** Request cancellation and run every registered callback. */
  public void cancel() {
    if (this == NONE) {
      throw new IllegalStateException("the shared 'none' token cannot be cancelled");
    }
    if (!cancelled.compareAndSet(false, true)) {
      return;
    }
    List<Runnable> pending = new ArrayList<>(callbacks);
    callbacks.clear();
    RuntimeException firstFailure = null;
    for (Runnable callback : pending) {
      try {
        callback.run();
      } catch (RuntimeException e) {
        if (firstFailure == null) {
          firstFailure = e;
        }
      }
    }
    if (firstFailure != null) {
      throw firstFailure;
    }
  }

  /**
   * Run {@code callback} when this token is cancelled, or immediately if it already has been.
   *
   * <p>Registering on {@link #none()} is a no-op, since that token can never be cancelled.
   */
  public void onCancel(Runnable callback) {
    if (this == NONE) {
      return;
    }
    if (cancelled.get()) {
      callback.run();
      return;
    }
    callbacks.add(callback);
    // Re-check: cancel() may have drained the list between the guard above and the add.
    if (cancelled.get() && callbacks.remove(callback)) {
      callback.run();
    }
  }

  /** Throw if cancellation has been requested. */
  public void throwIfCancelled(String message) {
    if (isCancelled()) {
      throw InvokerException.cancelled(message);
    }
  }
}

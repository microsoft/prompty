/**
 * Cooperative cancellation for canonical turn-engine effect boundaries.
 */

/** Raised by ports that abort cooperatively while waiting for cancellation. */
export class TurnCancellationError extends Error {
  constructor(message = "Turn execution was cancelled") {
    super(message);
    this.name = "TurnCancellationError";
  }
}

/**
 * A runtime-native cancellation token that can bridge an AbortSignal.
 *
 * Cancellation is sticky. Callers can synchronously inspect the token or await
 * cancellation without polling.
 */
export class TurnCancellationToken {
  readonly #listeners = new Set<() => void>();
  #cancelled = false;

  constructor(signal?: AbortSignal) {
    if (signal) {
      if (signal.aborted) {
        this.#cancelled = true;
      } else {
        signal.addEventListener("abort", () => this.cancel(), { once: true });
      }
    }
  }

  static fromAbortSignal(signal: AbortSignal): TurnCancellationToken {
    return new TurnCancellationToken(signal);
  }

  get isCancellationRequested(): boolean {
    return this.#cancelled;
  }

  cancel(): void {
    if (this.#cancelled) {
      return;
    }
    this.#cancelled = true;
    for (const listener of this.#listeners) {
      listener();
    }
    this.#listeners.clear();
  }

  throwIfCancellationRequested(): void {
    if (this.#cancelled) {
      throw new TurnCancellationError();
    }
  }

  waitForCancellation(): Promise<void> {
    if (this.#cancelled) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#listeners.add(resolve);
    });
  }
}

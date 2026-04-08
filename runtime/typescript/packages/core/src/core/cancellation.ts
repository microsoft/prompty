/**
 * §13.2 Cancellation — cooperative cancellation via AbortSignal.
 * @module
 */

/**
 * Error thrown when the agent loop is cancelled.
 */
export class CancelledError extends Error {
  constructor(message = "Agent loop cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

/**
 * Check if the signal is aborted, and throw CancelledError if so.
 */
export function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CancelledError();
  }
}

/**
 * §13.5 Steering — inject user messages into a running agent loop.
 * @module
 */

import { Message } from "./types.js";

/**
 * A handle for injecting user messages into a running agent loop.
 * Thread-safe in the JS single-threaded model (no locking needed).
 */
export class Steering {
  private queue: string[] = [];

  /** Enqueue a message to be injected at the next iteration. */
  send(message: string): void {
    this.queue.push(message);
  }

  /** Remove and return all queued messages as Message objects. */
  drain(): Message[] {
    const items = this.queue.splice(0);
    return items.map((text) => new Message({ role: "user", parts: [{ kind: "text", value: text }] }));
  }

  /** Whether there are pending messages without consuming them. */
  get hasPending(): boolean {
    return this.queue.length > 0;
  }
}

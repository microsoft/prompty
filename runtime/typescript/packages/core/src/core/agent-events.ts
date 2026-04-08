/**
 * §13.1 Agent Loop Events — structured event callbacks.
 * @module
 */

/** Event types emitted during the agent loop. */
export type AgentEventType =
  | "token"
  | "thinking"
  | "tool_call_start"
  | "tool_result"
  | "status"
  | "messages_updated"
  | "done"
  | "error"
  | "cancelled";

/** Callback signature for agent loop events. */
export type EventCallback = (eventType: AgentEventType, data: Record<string, unknown>) => void;

/**
 * Safely emit an event. Swallows errors from callback (spec §13.1:
 * event callbacks MUST NOT block the loop).
 */
export function emitEvent(
  callback: EventCallback | undefined,
  eventType: AgentEventType,
  data: Record<string, unknown>,
): void {
  if (!callback) return;
  try {
    callback(eventType, data);
  } catch (err) {
    // Swallow — event callbacks must not break the loop (§13.1)
    if (typeof globalThis.console?.debug === "function") {
      globalThis.console.debug(`Event callback error for ${eventType}:`, err);
    }
  }
}

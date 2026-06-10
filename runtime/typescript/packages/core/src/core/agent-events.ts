/**
 * §13.1 Agent Loop Events — structured event callbacks.
 * @module
 */

/** Event types emitted during the agent loop. */
export type AgentEventType =
  | "turn_start"
  | "turn_end"
  | "llm_start"
  | "llm_complete"
  | "retry"
  | "permission_requested"
  | "permission_completed"
  | "token"
  | "thinking"
  | "tool_call_start"
  | "tool_call_complete"
  | "tool_result"
  | "status"
  | "messages_updated"
  | "done"
  | "error"
  | "cancelled"
  | "compaction_start"
  | "compaction_complete"
  | "compaction_failed";

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
    callback(eventType, {
      ...data,
      turnEvent: {
        id: `evt_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        type: eventType,
        timestamp: new Date().toISOString(),
        iteration: typeof data.iteration === "number" ? data.iteration : undefined,
        payload: data,
      },
    });
  } catch (err) {
    // Swallow — event callbacks must not break the loop (§13.1)
    if (typeof globalThis.console?.debug === "function") {
      globalThis.console.debug(`Event callback error for ${eventType}:`, err);
    }
  }
}

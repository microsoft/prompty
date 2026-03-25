/**
 * Console tracer backend — prints trace events to stderr.
 *
 * @module
 */

import type { TracerFactory } from "./tracer.js";

/**
 * A tracer factory that prints all span events to stderr.
 *
 * @example
 * ```ts
 * import { Tracer } from "prompty";
 * import { consoleTracer } from "prompty/tracing";
 * Tracer.add("console", consoleTracer);
 * ```
 */
export const consoleTracer: TracerFactory = (signature: string) => {
  console.error(`[Tracer] ── ${signature}`);
  return (key: string, value: unknown) => {
    if (key === "__end__") return;
    const display = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
    const truncated = display.length > 200 ? display.slice(0, 200) + "..." : display;
    console.error(`[Tracer]    ${key}: ${truncated}`);
  };
};

/**
 * OpenTelemetry trace backend for Prompty.
 *
 * Plugs into the Tracer registry and emits OTel spans with structured
 * attributes. Requires `@opentelemetry/api` — install as a peer dependency.
 *
 * Usage:
 * ```typescript
 * import { Tracer } from "@prompty/core";
 * import { otelTracer } from "@prompty/core/tracing/otel";
 * import * as otelApi from "@opentelemetry/api";
 *
 * Tracer.add("otel", otelTracer(otelApi));
 * // or with custom tracer name:
 * Tracer.add("otel", otelTracer(otelApi, { tracerName: "my.service" }));
 * ```
 *
 * @module
 */

import type { TracerFactory, TracerBackend } from "./tracer.js";
import { toSerializable } from "./tracer.js";

/** The subset of `@opentelemetry/api` needed by this module. */
export interface OtelApi {
  trace: {
    getTracer(name: string): {
      startSpan(name: string): OtelSpan;
    };
    setSpan(context: unknown, span: OtelSpan): unknown;
  };
  context: {
    active(): unknown;
    with<T>(context: unknown, fn: () => T): T;
  };
  SpanStatusCode: {
    OK: number;
    ERROR: number;
  };
}

interface OtelSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(exception: Error): void;
  end(): void;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Options for {@link otelTracer}. */
export interface OtelTracerOptions {
  /** OTel tracer name. Defaults to `"prompty"`. */
  tracerName?: string;
}

const DEFAULT_TRACER_NAME = "prompty";

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

/**
 * Recursively flatten a nested object into dotted-key span attributes.
 *
 * ```
 * { model: { id: "gpt-4" } }  →  span.setAttribute("model.id", "gpt-4")
 * ```
 */
function setAttributes(
  span: { setAttribute(key: string, value: string | number | boolean): void },
  prefix: string,
  value: unknown,
): void {
  if (value === null || value === undefined) return;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    span.setAttribute(prefix, value);
    return;
  }

  if (Array.isArray(value)) {
    try {
      span.setAttribute(prefix, JSON.stringify(value));
    } catch {
      span.setAttribute(prefix, String(value));
    }
    return;
  }

  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      setAttributes(span, `${prefix}.${k}`, v);
    }
    return;
  }

  span.setAttribute(prefix, String(value));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an OTel trace backend compatible with `Tracer.add()`.
 *
 * Each call to the returned factory starts a new OTel span named after the
 * Prompty pipeline step. The backend receives `(key, value)` events and
 * sets them as span attributes. On `__end__`, the span is ended.
 *
 * Special handling:
 * - `error` key sets `StatusCode.ERROR` and records the exception.
 * - `__end__` key ends the span.
 * - All other values are serialized and expanded into dotted attributes.
 *
 * @param api - The `@opentelemetry/api` module. Pass `require("@opentelemetry/api")`
 *   or the result of `await import("@opentelemetry/api")`.
 * @param options - Optional configuration.
 * @returns A `TracerFactory` suitable for `Tracer.add()`.
 */
export function otelTracer(api: OtelApi, options?: OtelTracerOptions): TracerFactory {
  const tracerName = options?.tracerName ?? DEFAULT_TRACER_NAME;
  const tracer = api.trace.getTracer(tracerName);

  return function otelFactory(signature: string): TracerBackend | null {
    const span = tracer.startSpan(signature);
    const ctx = api.trace.setSpan(api.context.active(), span);

    // Make this span the active context so nested spans are parented.
    api.context.with(ctx, () => {});

    const backend: TracerBackend = (key: string, value: unknown) => {
      if (key === "__end__") {
        span.end();
        return;
      }

      if (key === "error") {
        span.setStatus({ code: api.SpanStatusCode.ERROR, message: String(value) });
        if (value instanceof Error) {
          span.recordException(value);
          if (value.stack) {
            span.setAttribute("exception.stacktrace", value.stack);
          }
        } else {
          span.setAttribute("exception.message", String(value));
        }
        return;
      }

      // Serialize and flatten into span attributes
      try {
        const serialized = toSerializable(value);
        setAttributes(span, key, serialized);
      } catch {
        // Tracer errors should never crash the pipeline
      }
    };

    return backend;
  };
}

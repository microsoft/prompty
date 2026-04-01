/**
 * Tracing framework — multi-backend registry with function wrappers.
 *
 * Matches the Python tracing architecture:
 * - `Tracer` registry holds named backends
 * - `trace()` wraps async functions with span tracking
 * - `traceSpan()` creates manual spans
 * - Each backend receives `(key, value)` events
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A tracer backend receives (key, value) events for a span. */
export type TracerBackend = (key: string, value: unknown) => void;

/** Factory: given a span signature, return a backend (or null to skip). */
export type TracerFactory = (signature: string) => TracerBackend | null;

// ---------------------------------------------------------------------------
// Tracer Registry
// ---------------------------------------------------------------------------

const backends = new Map<string, TracerFactory>();

export const Tracer = {
  /**
   * Register a tracer backend.
   *
   * @param name - Unique name for this backend.
   * @param factory - Called for each new span; return a callback or null.
   */
  add(name: string, factory: TracerFactory): void {
    backends.set(name, factory);
  },

  /** Remove a tracer backend by name. */
  remove(name: string): void {
    backends.delete(name);
  },

  /** Remove all backends. */
  clear(): void {
    backends.clear();
  },

  /**
   * Start a new trace span. Returns a callback for emitting events
   * and a `end()` function to close the span.
   */
  start(signature: string): SpanEmitter {
    const active: TracerBackend[] = [];
    for (const factory of backends.values()) {
      const backend = factory(signature);
      if (backend) active.push(backend);
    }

    const emit: SpanEmitter = (key: string, value: unknown) => {
      for (const b of active) {
        try {
          b(key, value);
        } catch {
          // tracer errors should never crash the pipeline
        }
      }
    };
    emit.end = () => {
      emit("__end__", Date.now());
    };
    return emit;
  },
};

export interface SpanEmitter {
  (key: string, value: unknown): void;
  end: () => void;
}

// ---------------------------------------------------------------------------
// trace() — function wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap an async function with tracing.
 *
 * Creates a span with the function name, traces inputs and output,
 * and measures duration.
 *
 * @param fn - The async function to wrap.
 * @param name - Optional span name (defaults to `fn.name`).
 * @returns Wrapped function with same signature.
 */
export function trace<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  name?: string,
): T {
  const spanName = name ?? fn.name ?? "anonymous";

  const wrapped = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
    const span = Tracer.start(spanName);
    const startTime = Date.now();

    try {
      span("inputs", sanitizeValue("inputs", args));
      const result = await fn.apply(this, args);
      span("result", result);
      span("duration_ms", Date.now() - startTime);
      span.end();
      return result;
    } catch (err) {
      span("error", err instanceof Error ? err.message : String(err));
      span("duration_ms", Date.now() - startTime);
      span.end();
      throw err;
    }
  } as unknown as T;

  // Preserve function name for debugging
  Object.defineProperty(wrapped, "name", { value: spanName });
  return wrapped;
}

// ---------------------------------------------------------------------------
// traceSpan() — manual span creation
// ---------------------------------------------------------------------------

/**
 * Execute a callback within a traced span.
 *
 * @param name - Span name.
 * @param fn - Callback receiving a `(key, value)` emitter.
 * @returns The callback's return value.
 */
export async function traceSpan<T>(
  name: string,
  fn: (emit: (key: string, value: unknown) => void) => Promise<T>,
): Promise<T> {
  const span = Tracer.start(name);
  const startTime = Date.now();

  try {
    const result = await fn(span);
    span("duration_ms", Date.now() - startTime);
    span.end();
    return result;
  } catch (err) {
    span("error", err instanceof Error ? err.message : String(err));
    span("duration_ms", Date.now() - startTime);
    span.end();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// @trace() — method decorator
// ---------------------------------------------------------------------------

/**
 * Method decorator that wraps a class method with tracing.
 *
 * ```typescript
 * class MyService {
 *   @traceMethod()
 *   async chat(question: string): Promise<string> { ... }
 * }
 * ```
 *
 * @param attributes - Optional key-value pairs to emit at the start of each span.
 */
export function traceMethod(attributes?: Record<string, unknown>) {
  return function (
    _target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original = descriptor.value;

    descriptor.value = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const span = Tracer.start(propertyKey);
      const startTime = Date.now();

      try {
        // Emit optional attributes
        if (attributes) {
          for (const [k, v] of Object.entries(attributes)) {
            span(k, v);
          }
        }

        span("inputs", sanitizeValue("inputs", args));
        const result = await original.apply(this, args);
        span("result", result);
        span("duration_ms", Date.now() - startTime);
        span.end();
        return result;
      } catch (err) {
        span("error", err instanceof Error ? err.message : String(err));
        span("duration_ms", Date.now() - startTime);
        span.end();
        throw err;
      }
    };

    // Preserve the original function name
    Object.defineProperty(descriptor.value, "name", { value: propertyKey });
    return descriptor;
  };
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

// Matches genuinely sensitive key names while avoiding false positives:
//   - `api_?key` matches apiKey, api_key but NOT primary_key, sort_key
//   - `token(?!s)` matches auth_token but NOT prompt_tokens, total_tokens
//   - `auth(?!ors?\b)` matches authorization but NOT author, authors
//   - `secret|password|credential|passphrase|bearer` are always sensitive
const SENSITIVE_PATTERN =
  /secret|password|credential|passphrase|bearer|api[_.]?key|token(?!s)|auth(?!ors?\b)/i;

/** Redact sensitive values from trace output. */
export function sanitizeValue(key: string, value: unknown): unknown {
  if (typeof key === "string" && SENSITIVE_PATTERN.test(key)) {
    return "***REDACTED***";
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      sanitized[k] = sanitizeValue(k, v);
    }
    return sanitized;
  }

  if (Array.isArray(value)) {
    return value.map((v, i) => sanitizeValue(String(i), v));
  }

  return value;
}

/**
 * Convert an arbitrary object to a JSON-serializable form.
 * Handles Date, Error, Map, Set, etc.
 */
export function toSerializable(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "boolean" || typeof obj === "number" || typeof obj === "string") return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof Error) return { name: obj.name, message: obj.message, stack: obj.stack };
  if (obj instanceof Map) return Object.fromEntries(obj);
  if (obj instanceof Set) return [...obj];
  if (Array.isArray(obj)) return obj.map(toSerializable);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = toSerializable(v);
    }
    return result;
  }
  return String(obj);
}

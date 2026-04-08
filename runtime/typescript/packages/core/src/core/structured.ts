/**
 * Structured result casting for typed LLM output.
 *
 * When a processor parses structured JSON from an LLM response, it wraps
 * the result in a `StructuredResult` that carries both the parsed data
 * (accessible as normal properties) and the raw JSON string (hidden behind
 * a Symbol). The `cast()` function lets callers deserialize directly from
 * the raw JSON, optionally running a validator (e.g., Zod `.parse`).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Symbol & interface
// ---------------------------------------------------------------------------

/**
 * Symbol used to store the raw JSON string on a StructuredResult.
 * Using a Symbol keeps the raw JSON invisible to normal property iteration.
 */
export const StructuredResultSymbol: unique symbol = Symbol("prompty.rawJson");

/**
 * A plain object carrying structured output from an LLM.
 * Behaves like a normal Record<string, unknown> but also stores the raw JSON
 * string so that cast() can deserialize directly to typed objects.
 */
export interface StructuredResult extends Record<string, unknown> {
  readonly [StructuredResultSymbol]: string;
}

// ---------------------------------------------------------------------------
// Factory & type guard
// ---------------------------------------------------------------------------

/**
 * Create a StructuredResult wrapping parsed data + raw JSON.
 */
export function createStructuredResult(
  data: Record<string, unknown>,
  rawJson: string,
): StructuredResult {
  const result = { ...data } as StructuredResult;
  Object.defineProperty(result, StructuredResultSymbol, {
    value: rawJson,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  return result;
}

/**
 * Type guard: is this value a StructuredResult?
 */
export function isStructuredResult(value: unknown): value is StructuredResult {
  return (
    typeof value === "object" &&
    value !== null &&
    StructuredResultSymbol in value
  );
}

// ---------------------------------------------------------------------------
// cast()
// ---------------------------------------------------------------------------

/**
 * Cast a result to a typed object. When the result is a StructuredResult,
 * deserializes directly from the raw JSON (no intermediate round-trip).
 *
 * @param result - The result to cast (StructuredResult, string, or object)
 * @param validator - Optional runtime validator (e.g., Zod .parse)
 * @returns The typed result
 */
export function cast<T = Record<string, unknown>>(
  result: unknown,
  validator?: (data: unknown) => T,
): T {
  let jsonStr: string;

  if (isStructuredResult(result)) {
    jsonStr = result[StructuredResultSymbol];
  } else if (typeof result === "string") {
    jsonStr = result;
  } else {
    jsonStr = JSON.stringify(result);
  }

  const parsed: unknown = JSON.parse(jsonStr);
  if (validator) {
    return validator(parsed);
  }
  return parsed as T;
}

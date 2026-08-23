/**
 * Typed load/validation errors for the Prompty loader and pipeline.
 *
 * `PromptyLoadError` carries a canonical `kind` (and optional `field`) so
 * conformance adapters can classify negative-path outcomes by error TYPE rather
 * than by matching substrings of the human-readable message. The `typraVector`
 * getter projects the error onto the canonical `{ kind, field? }` payload the
 * `@vector` `expectedError` harness compares against.
 *
 * @module
 */

/** Canonical load/validation error categories used by conformance vectors. */
export type LoadErrorKind =
  | "env_var_not_set"
  | "file_reference"
  | "file_not_found"
  | "invalid_frontmatter"
  | "invalid_template"
  | "missing_required_input";

/**
 * A typed error raised by the loader/pipeline for negative-path load and
 * input-validation failures. Subclasses `Error`, so existing callers that only
 * inspect `.message` or `instanceof Error` keep working.
 */
export class PromptyLoadError extends Error {
  /** Canonical error category. */
  readonly kind: LoadErrorKind;
  /** Offending input/property name (for `missing_required_input`). */
  readonly field?: string;

  constructor(kind: LoadErrorKind, message: string, field?: string) {
    super(message);
    this.name = "PromptyLoadError";
    this.kind = kind;
    this.field = field;
  }

  /** Canonical `{ kind, field? }` payload for `expectedError` conformance. */
  get typraVector(): Record<string, unknown> {
    return this.field !== undefined
      ? { kind: this.kind, field: this.field }
      : { kind: this.kind };
  }
}

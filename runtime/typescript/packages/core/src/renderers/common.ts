/**
 * Shared renderer utilities — nonce-based thread marker injection.
 *
 * When inputs contain thread-kind values (`kind: "thread"` in inputs),
 * the renderer substitutes a unique nonce string instead of the actual value.
 * After parsing, the pipeline replaces nonce strings with ThreadMarker objects.
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import type { Prompty } from "../model/prompty.js";
import { RICH_KINDS } from "../core/types.js";

/** Map of input name → nonce string (set during rendering, read during prepare). */
let lastNonces: Map<string, string> = new Map();

/**
 * Prepare render inputs: replace thread/image/file/audio values with nonces.
 *
 * @returns `[modifiedInputs, noncesMap]`
 */
export function prepareRenderInputs(
  agent: Prompty,
  inputs: Record<string, unknown>,
): [Record<string, unknown>, Map<string, string>] {
  const nonces = new Map<string, string>();
  const richNames = getRichInputNames(agent);
  const modified = { ...inputs };

  for (const [name, kind] of Object.entries(richNames)) {
    if (kind === "thread" || RICH_KINDS.has(kind)) {
      const nonce = `__prompty_nonce_${randomUUID().replace(/-/g, "")}__`;
      nonces.set(name, nonce);
      modified[name] = nonce;
    }
  }

  // Stash for retrieval by prepare()
  lastNonces = nonces;
  return [modified, nonces];
}

/** Retrieve the last nonce mapping set by `prepareRenderInputs`. */
export function getLastNonces(): Map<string, string> {
  return lastNonces;
}

/** Clear the stashed nonces. */
export function clearLastNonces(): void {
  lastNonces = new Map();
}

/**
 * Get map of `{propertyName: kind}` for inputs with rich kinds
 * (thread, image, file, audio).
 */
function getRichInputNames(agent: Prompty): Record<string, string> {
  const result: Record<string, string> = {};
  const props = agent.inputs;
  if (!props || props.length === 0) return result;

  for (const prop of props) {
    const kind = prop.kind?.toLowerCase() ?? "";
    if (RICH_KINDS.has(kind) && prop.name) {
      result[prop.name] = kind;
    }
  }
  return result;
}

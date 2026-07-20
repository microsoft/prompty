/**
 * Nunjucks renderer — Jinja2-compatible template rendering for TypeScript.
 *
 * Nunjucks is the standard Jinja2-compatible engine for Node.js.
 * This renderer replaces thread-kind inputs with nonce markers
 * before rendering.
 *
 * @module
 */

import nunjucks from "nunjucks";
import type { Prompty } from "../model/agent/prompty.js";
import type { Renderer } from "../core/interfaces.js";
import { prepareRenderInputs } from "./common.js";

type NunjucksRuntime = {
  memberLookup: (object: unknown, property: unknown) => unknown;
  callWrap: (callable: unknown, name: string, context: unknown, args: unknown[]) => unknown;
};

const UNSAFE_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: false,
});

function safeMemberLookup(object: unknown, property: unknown): unknown {
  if (typeof property === "string" && UNSAFE_PROPERTIES.has(property)) {
    throw new Error(`Unsafe template member access: ${property}`);
  }

  if (
    (typeof property !== "string" && typeof property !== "number") ||
    object === null ||
    typeof object !== "object"
  ) {
    return undefined;
  }

  const descriptor = Object.getOwnPropertyDescriptor(object, property);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function safeCallWrap(_callable: unknown, name: string, _context: unknown, _args: unknown[]): never {
  throw new Error(`Template function calls are not allowed: ${name}`);
}

function sanitizeValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "object") {
    return undefined;
  }

  const existing = seen.get(value);
  if (existing !== undefined) {
    return existing;
  }

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    for (const item of value) {
      result.push(sanitizeValue(item, seen));
    }
    return result;
  }

  const result = Object.create(null) as Record<string, unknown>;
  seen.set(value, result);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!UNSAFE_PROPERTIES.has(key) && "value" in descriptor) {
      result[key] = sanitizeValue(descriptor.value, seen);
    }
  }
  return result;
}

function sanitizeInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(inputs) as Record<string, unknown>;
}

function renderSafely(template: string, inputs: Record<string, unknown>): string {
  const runtime = nunjucks.runtime as unknown as NunjucksRuntime;
  const memberLookup = runtime.memberLookup;
  const callWrap = runtime.callWrap;
  runtime.memberLookup = safeMemberLookup;
  runtime.callWrap = safeCallWrap;

  try {
    return env.renderString(template, inputs);
  } finally {
    runtime.memberLookup = memberLookup;
    runtime.callWrap = callWrap;
  }
}

export class NunjucksRenderer implements Renderer {
  async render(
    agent: Prompty,
    template: string,
    inputs: Record<string, unknown>,
  ): Promise<string> {
    const [modified] = prepareRenderInputs(agent, inputs);
    return renderSafely(template, sanitizeInputs(modified));
  }
}

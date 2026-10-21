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
import type { Agent } from "../model/agent.js";
import type { Renderer } from "../core/interfaces.js";
import { prepareRenderInputs } from "./common.js";

type NunjucksRuntime = {
  memberLookup: (object: unknown, property: unknown) => unknown;
  callWrap: (
    callable: unknown,
    name: string,
    context: unknown,
    args: unknown[],
  ) => unknown;
  truthy?: (value: unknown) => boolean;
};

type CompilerPrototype = Record<
  string,
  (
    this: CompilerInstance,
    node: Node,
    frame: unknown,
    ...rest: unknown[]
  ) => void
>;

type Node = {
  cond: unknown;
  body: unknown;
  else_: unknown;
  left: unknown;
  right: unknown;
  target: unknown;
};

type CompilerInstance = {
  _emit(code: string): void;
  _emitLine(code: string): void;
  compile(node: unknown, frame: unknown): void;
  _compileExpression(node: unknown, frame: unknown): void;
  _withScopedSyntax(fn: () => void): void;
};

const UNSAFE_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: false,
});

// Jinja2 (the reference engine, spec/jinja-subset.md §2.2) treats empty lists and
// empty maps as falsy, so `{% if docs %}` skips the block when `docs` is `[]`.
// Nunjucks compiles conditions to bare JavaScript truthiness, where `[]` and `{}`
// are truthy. `jinjaTruthy` restores the reference semantics.
function jinjaTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof String) return value.length > 0;
  if (value !== null && typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

// Emit `runtime.truthy(...)` around every condition nunjucks would otherwise
// evaluate with JavaScript truthiness. Applied only while a template is being
// compiled by `renderSafely` and restored afterwards, like the runtime hooks.
function installTruthinessCompiler(): () => void {
  const proto = (
    nunjucks as unknown as {
      compiler: { Compiler: { prototype: CompilerPrototype } };
    }
  ).compiler.Compiler.prototype;
  const saved = {
    compileIf: proto.compileIf,
    compileInlineIf: proto.compileInlineIf,
    compileNot: proto.compileNot,
    compileAnd: proto.compileAnd,
    compileOr: proto.compileOr,
  };

  proto.compileIf = function (node, frame, async) {
    const emitBranch = (branch: unknown) =>
      this._withScopedSyntax(() => {
        this.compile(branch, frame);
        if (async) this._emit("cb()");
      });
    this._emit("if(runtime.truthy(");
    this._compileExpression(node.cond, frame);
    this._emitLine(")) {");
    emitBranch(node.body);
    if (node.else_) {
      this._emitLine("}\nelse {");
      emitBranch(node.else_);
    } else if (async) {
      this._emitLine("}\nelse {");
      this._emit("cb()");
    }
    this._emitLine("}");
  };
  proto.compileInlineIf = function (node, frame) {
    this._emit("(runtime.truthy(");
    this.compile(node.cond, frame);
    this._emit(")?");
    this.compile(node.body, frame);
    this._emit(":");
    if (node.else_ !== null) {
      this.compile(node.else_, frame);
    } else {
      this._emit('""');
    }
    this._emit(")");
  };
  proto.compileNot = function (node, frame) {
    this._emit("!runtime.truthy(");
    this.compile(node.target, frame);
    this._emit(")");
  };
  // `a and b` / `a or b` yield an operand (not a boolean) in both Jinja2 and
  // nunjucks, so keep that shape and only change the truthiness test.
  proto.compileAnd = function (node, frame) {
    this._emit("(function(l){return runtime.truthy(l)?(");
    this.compile(node.right, frame);
    this._emit("):l;})(");
    this.compile(node.left, frame);
    this._emit(")");
  };
  proto.compileOr = function (node, frame) {
    this._emit("(function(l){return runtime.truthy(l)?l:(");
    this.compile(node.right, frame);
    this._emit(");})(");
    this.compile(node.left, frame);
    this._emit(")");
  };

  return () => Object.assign(proto, saved);
}

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
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function safeCallWrap(
  _callable: unknown,
  name: string,
  _context: unknown,
  _args: unknown[],
): never {
  throw new Error(`Template function calls are not allowed: ${name}`);
}

function sanitizeValue(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
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
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!UNSAFE_PROPERTIES.has(key) && "value" in descriptor) {
      result[key] = sanitizeValue(descriptor.value, seen);
    }
  }
  return result;
}

function sanitizeInputs(
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeValue(inputs) as Record<string, unknown>;
}

// Jinja2 filters coerce rather than throw: an omitted input is "", numbers and
// booleans stringify, and `join` over a missing value is "". The nunjucks builtins
// call string/array methods directly and raise TypeError instead, which turned an
// optional input piped through `trim` into a render failure.
const text = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);
const nunjucksJoin = env.getFilter("join") as (
  items: unknown,
  sep?: string,
  attr?: string,
) => string;

env.addFilter("upper", (value: unknown) => text(value).toUpperCase());
env.addFilter("lower", (value: unknown) => text(value).toLowerCase());
env.addFilter("trim", (value: unknown) => text(value).trim());
env.addFilter("join", (items: unknown, sep?: string, attr?: string) => {
  if (items === undefined || items === null) return "";
  if (typeof items === "string")
    return nunjucksJoin(Array.from(items), sep, attr);
  if (typeof items === "object" && !Array.isArray(items)) {
    return nunjucksJoin(Object.keys(items), sep, attr);
  }
  return nunjucksJoin(items, sep, attr);
});

function renderSafely(
  template: string,
  inputs: Record<string, unknown>,
): string {
  const runtime = nunjucks.runtime as unknown as NunjucksRuntime;
  const memberLookup = runtime.memberLookup;
  const callWrap = runtime.callWrap;
  const truthy = runtime.truthy;
  runtime.memberLookup = safeMemberLookup;
  runtime.callWrap = safeCallWrap;
  runtime.truthy = jinjaTruthy;
  const restoreCompiler = installTruthinessCompiler();

  try {
    return env.renderString(template, inputs);
  } finally {
    restoreCompiler();
    runtime.memberLookup = memberLookup;
    runtime.callWrap = callWrap;
    runtime.truthy = truthy;
  }
}

export class NunjucksRenderer implements Renderer {
  async render(
    agent: Agent,
    template: string,
    inputs: Record<string, unknown>,
  ): Promise<string> {
    const [modified] = prepareRenderInputs(agent, inputs);
    return renderSafely(template, sanitizeInputs(modified));
  }
}

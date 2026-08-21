import type { Expr, Node, PathSeg } from "./ast.js";
import { StrictViolationError } from "./errors.js";
import { parseTemplate } from "./parser.js";

export interface Segment {
  kind: "literal" | "interp";
  text: string;
  source: string | null;
  strict: boolean;
}

const UNDEFINED = Symbol("undefined");
type UndefinedValue = typeof UNDEFINED;
type RuntimeValue = unknown | UndefinedValue;
const ROLE_BOUNDARY = /^\s*(system|user|assistant|developer)\s*:/im;

interface Frame {
  scope: Map<string, RuntimeValue>;
  strictProps: Set<string>;
}

export function renderSegments(
  template: string,
  inputs: Record<string, unknown> = {},
  strictProps: string[] = [],
): Segment[] {
  const scope = new Map<string, RuntimeValue>();
  for (const [key, value] of Object.entries(inputs)) scope.set(key, value);
  const frame: Frame = { scope, strictProps: new Set(strictProps) };
  const out: Segment[] = [];
  renderNodes(parseTemplate(template), frame, out);
  return out;
}

export function render(
  template: string,
  inputs: Record<string, unknown> = {},
  strictProps: string[] = [],
): string {
  return renderSegments(template, inputs, strictProps)
    .map((segment) => segment.text)
    .join("");
}

function isUndefined(value: RuntimeValue): value is UndefinedValue {
  return value === UNDEFINED;
}

function isPlainObject(value: RuntimeValue): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Map);
}

function isMap(value: RuntimeValue): value is Map<unknown, unknown> {
  return value instanceof Map;
}

function isNumeric(value: RuntimeValue): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

function truthy(value: RuntimeValue): boolean {
  if (value == null || isUndefined(value)) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isMap(value)) return value.size > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

function stringify(value: RuntimeValue): string {
  if (value == null || isUndefined(value)) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (Number.isFinite(value) && Number.isInteger(value)) return String(value);
    return String(value);
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => stringify(item)).join("");
  if (isMap(value)) {
    return `{${Array.from(value.entries())
      .map(([key, item]) => `'${String(key)}': ${stringify(item)}`)
      .join(", ")}}`;
  }
  if (isPlainObject(value)) {
    return `{${Object.entries(value)
      .map(([key, item]) => `'${key}': ${stringify(item)}`)
      .join(", ")}}`;
  }
  return String(value);
}

function lookup(root: string, scope: ReadonlyMap<string, RuntimeValue>): RuntimeValue {
  return scope.has(root) ? scope.get(root) : UNDEFINED;
}

function access(value: RuntimeValue, seg: PathSeg, scope: ReadonlyMap<string, RuntimeValue>): RuntimeValue {
  if (value == null || isUndefined(value)) return UNDEFINED;

  if (seg.kind === "attr") {
    if (isMap(value)) return value.has(seg.name) ? value.get(seg.name) : UNDEFINED;
    if (isPlainObject(value)) return Object.prototype.hasOwnProperty.call(value, seg.name) ? value[seg.name] : UNDEFINED;
    return UNDEFINED;
  }

  const index = evalExpr(seg.expr, scope);
  try {
    if (isMap(value)) {
      const key = stringify(index);
      return value.has(key) ? value.get(key) : UNDEFINED;
    }
    if (isPlainObject(value)) {
      const key = stringify(index);
      return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : UNDEFINED;
    }
    if (Array.isArray(value)) {
      let idx = toIndex(index);
      if (idx < 0) idx += value.length;
      return idx >= 0 && idx < value.length ? value[idx] : UNDEFINED;
    }
    if (typeof value === "string") {
      let idx = toIndex(index);
      if (idx < 0) idx += value.length;
      return idx >= 0 && idx < value.length ? value[idx] : UNDEFINED;
    }
  } catch {
    return UNDEFINED;
  }
  return UNDEFINED;
}

function toIndex(value: RuntimeValue): number {
  if (typeof value === "number") return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new Error("Non-integer index");
}

function evalExpr(expr: Expr, scope: ReadonlyMap<string, RuntimeValue>): RuntimeValue {
  switch (expr.kind) {
    case "lit":
      return expr.value;
    case "var": {
      let value = lookup(expr.root, scope);
      for (const seg of expr.path) value = access(value, seg, scope);
      return value;
    }
    case "filter":
      return applyFilter(expr, scope);
    case "unary":
      return !truthy(evalExpr(expr.operand, scope));
    case "binary":
      return evalBinary(expr, scope);
  }
}

function evalBinary(expr: Extract<Expr, { kind: "binary" }>, scope: ReadonlyMap<string, RuntimeValue>): RuntimeValue {
  if (expr.operator === "and") {
    const left = evalExpr(expr.left, scope);
    return truthy(left) ? evalExpr(expr.right, scope) : left;
  }
  if (expr.operator === "or") {
    const left = evalExpr(expr.left, scope);
    return truthy(left) ? left : evalExpr(expr.right, scope);
  }

  const leftRaw = evalExpr(expr.left, scope);
  const rightRaw = evalExpr(expr.right, scope);
  if (expr.operator === "in") return evalIn(leftRaw, rightRaw);

  const left = isUndefined(leftRaw) ? null : leftRaw;
  const right = isUndefined(rightRaw) ? null : rightRaw;

  if (expr.operator === "==") return valueEquals(left, right);
  if (expr.operator === "!=") return !valueEquals(left, right);

  if (isNumeric(left) && isNumeric(right)) {
    if (expr.operator === "<") return left < right;
    if (expr.operator === ">") return left > right;
    if (expr.operator === "<=") return left <= right;
    if (expr.operator === ">=") return left >= right;
  }
  if (typeof left === "string" && typeof right === "string") {
    if (expr.operator === "<") return left < right;
    if (expr.operator === ">") return left > right;
    if (expr.operator === "<=") return left <= right;
    if (expr.operator === ">=") return left >= right;
  }
  return false;
}

function evalIn(left: RuntimeValue, right: RuntimeValue): boolean {
  const normalizedLeft = isUndefined(left) ? null : left;
  if (isMap(right)) return typeof normalizedLeft === "string" && right.has(normalizedLeft);
  if (isPlainObject(right)) return typeof normalizedLeft === "string" && Object.prototype.hasOwnProperty.call(right, normalizedLeft);
  if (Array.isArray(right)) return right.some((item) => valueEquals(isUndefined(item) ? null : item, normalizedLeft));
  if (typeof right === "string") return typeof normalizedLeft === "string" && right.includes(normalizedLeft);
  return false;
}

function valueEquals(left: RuntimeValue, right: RuntimeValue): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  if (isNumeric(left) && isNumeric(right)) return left === right;
  return Object.is(left, right);
}

function applyFilter(expr: Extract<Expr, { kind: "filter" }>, scope: ReadonlyMap<string, RuntimeValue>): RuntimeValue {
  const value = evalExpr(expr.input, scope);
  const args = expr.args.map((arg) => evalExpr(arg, scope));
  switch (expr.name) {
    case "upper":
      return stringify(value).toUpperCase();
    case "lower":
      return stringify(value).toLowerCase();
    case "trim":
      return stringify(value).trim();
    case "join": {
      const sep = args.length > 0 ? stringify(args[0]) : "";
      return Array.isArray(value) ? value.map((item) => stringify(item)).join(sep) : "";
    }
    case "length":
      if (value == null || isUndefined(value)) return 0;
      if (typeof value === "string" || Array.isArray(value)) return value.length;
      if (isMap(value)) return value.size;
      if (isPlainObject(value)) return Object.keys(value).length;
      return 0;
    case "default":
      return value == null || isUndefined(value) ? (args[0] ?? "") : value;
    case "replace": {
      if (args.length < 2) throw new Error("replace filter requires (old, new) arguments");
      const subject = stringify(value);
      const oldValue = stringify(args[0]);
      if (oldValue.length === 0) return subject;
      return subject.split(oldValue).join(stringify(args[1]));
    }
    default:
      throw new Error(`Unknown filter: ${expr.name}`);
  }
}

function iterSeq(value: RuntimeValue): RuntimeValue[] {
  if (value == null || isUndefined(value)) return [];
  if (isMap(value)) return Array.from(value.keys());
  if (isPlainObject(value)) return Object.keys(value);
  if (Array.isArray(value)) return [...value];
  if (typeof value === "string") return Array.from(value);
  return [];
}

function interpSource(expr: Expr): string | null {
  return expr.kind === "var" ? expr.root : null;
}

function renderNodes(nodes: readonly Node[], frame: Frame, out: Segment[]): void {
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        appendLiteral(out, node.value);
        break;
      case "interp": {
        const value = evalExpr(node.expr, frame.scope);
        const text = stringify(value);
        const source = interpSource(node.expr);
        const strict = source !== null && frame.strictProps.has(source);
        if (strict && ROLE_BOUNDARY.test(text)) {
          throw new StrictViolationError(`strict input '${source}' produced a forged role boundary: ${text}`);
        }
        if (text.length > 0) out.push({ kind: "interp", text, source, strict });
        break;
      }
      case "if":
        renderIf(node, frame, out);
        break;
      case "for":
        renderFor(node, frame, out);
        break;
    }
  }
}

function appendLiteral(out: Segment[], text: string): void {
  if (text.length === 0) return;
  const last = out[out.length - 1];
  if (last?.kind === "literal") {
    last.text += text;
  } else {
    out.push({ kind: "literal", text, source: null, strict: false });
  }
}

function renderIf(node: Extract<Node, { kind: "if" }>, frame: Frame, out: Segment[]): void {
  for (const branch of node.branches) {
    if (truthy(evalExpr(branch.test, frame.scope))) {
      renderNodes(branch.body, frame, out);
      return;
    }
  }
  if (node.elseBody) renderNodes(node.elseBody, frame, out);
}

function renderFor(node: Extract<Node, { kind: "for" }>, frame: Frame, out: Segment[]): void {
  const items = iterSeq(evalExpr(node.seq, frame.scope));
  const total = items.length;
  for (let idx = 0; idx < total; idx += 1) {
    const childScope = new Map(frame.scope);
    childScope.set(node.loopVar, items[idx]);
    childScope.set(
      "loop",
      {
        index: idx + 1,
        index0: idx,
        first: idx === 0,
        last: idx === total - 1,
        length: total,
      },
    );
    renderNodes(node.body, { scope: childScope, strictProps: frame.strictProps }, out);
  }
}

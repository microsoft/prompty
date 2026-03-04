/**
 * Plugin registry for Prompty pipeline components.
 *
 * TypeScript doesn't have Python's entry-point system, so we use
 * explicit registration. Built-in implementations are registered
 * when the package is imported (see src/index.ts).
 *
 * Third-party plugins call `registerRenderer()`, etc. at module load.
 *
 * @module
 */

import type { Renderer, Parser, Executor, Processor } from "./interfaces.js";

// ---------------------------------------------------------------------------
// Internal Maps
// ---------------------------------------------------------------------------

const renderers = new Map<string, Renderer>();
const parsers = new Map<string, Parser>();
const executors = new Map<string, Executor>();
const processors = new Map<string, Processor>();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerRenderer(key: string, impl: Renderer): void {
  renderers.set(key, impl);
}

export function registerParser(key: string, impl: Parser): void {
  parsers.set(key, impl);
}

export function registerExecutor(key: string, impl: Executor): void {
  executors.set(key, impl);
}

export function registerProcessor(key: string, impl: Processor): void {
  processors.set(key, impl);
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export class InvokerError extends Error {
  constructor(
    public readonly group: string,
    public readonly key: string,
  ) {
    super(
      `No ${group} registered for key "${key}". ` +
      `Register one with register${group.charAt(0).toUpperCase() + group.slice(1)}("${key}", impl) ` +
      `or install a package that provides it.`,
    );
    this.name = "InvokerError";
  }
}

export function getRenderer(key: string): Renderer {
  const r = renderers.get(key);
  if (!r) throw new InvokerError("renderer", key);
  return r;
}

export function getParser(key: string): Parser {
  const p = parsers.get(key);
  if (!p) throw new InvokerError("parser", key);
  return p;
}

export function getExecutor(key: string): Executor {
  const e = executors.get(key);
  if (!e) throw new InvokerError("executor", key);
  return e;
}

export function getProcessor(key: string): Processor {
  const p = processors.get(key);
  if (!p) throw new InvokerError("processor", key);
  return p;
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

/** Clear all registered implementations. Useful in tests. */
export function clearCache(): void {
  renderers.clear();
  parsers.clear();
  executors.clear();
  processors.clear();
}

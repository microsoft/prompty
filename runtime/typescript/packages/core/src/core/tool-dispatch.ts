/**
 * Two-layer tool dispatch for the agent loop (spec §11.2).
 *
 * **Layer 1 — Name registry**: per-tool handlers keyed by tool name.
 * Explicit overrides and user-provided function callables live here.
 * API: {@link registerTool}, {@link getTool}, {@link clearTools}.
 *
 * **Layer 2 — Kind handlers**: per-kind handlers keyed by tool kind
 * (`"function"`, `"prompty"`, `"mcp"`, `"openapi"`, `"*"`).
 * Extensible fallbacks that handle entire categories of tools.
 * API: {@link registerToolHandler}, {@link getToolHandler},
 * {@link clearToolHandlers}.
 *
 * Dispatch order (in {@link dispatchTool}):
 * 1. User-provided `tools` object (per-call override, highest priority)
 * 2. Global name registry ({@link getTool})
 * 3. Kind handler fallback ({@link getToolHandler})
 *
 * Built-in kind handlers are auto-registered at import time.
 *
 * @module
 */

import { dirname, resolve } from "node:path";
import type { Prompty } from "../model/prompty.js";

// ---------------------------------------------------------------------------
// ToolHandler interface
// ---------------------------------------------------------------------------

/**
 * A handler that knows how to execute a specific kind of tool.
 *
 * Implementations are registered with {@link registerToolHandler} and
 * looked up by `tool.kind` at dispatch time.
 */
export interface ToolHandler {
  executeTool(
    tool: Record<string, unknown>,
    args: Record<string, unknown>,
    agent: Prompty,
    parentInputs: Record<string, unknown>,
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown when {@link getToolHandler} cannot find a handler for the
 * requested tool kind.
 */
export class ToolHandlerError extends Error {
  constructor(public readonly kind: string) {
    super(
      `No tool handler registered for kind '${kind}'. ` +
        `Register one with registerToolHandler().`,
    );
    this.name = "ToolHandlerError";
  }
}

// ---------------------------------------------------------------------------
// Layer 1: Name Registry (spec §11.2 — per-tool handlers by name)
// ---------------------------------------------------------------------------

const nameRegistry = new Map<string, (...args: unknown[]) => unknown>();

/**
 * Register a per-name tool handler (spec §11.2 Layer 1).
 * Name-registered tools take priority over kind handlers.
 */
export function registerTool(
  name: string,
  handler: (...args: unknown[]) => unknown,
): void {
  nameRegistry.set(name, handler);
}

/**
 * Look up a per-name handler; return `undefined` if absent.
 */
export function getTool(
  name: string,
): ((...args: unknown[]) => unknown) | undefined {
  return nameRegistry.get(name);
}

/**
 * Remove all per-name registrations (for testing).
 */
export function clearTools(): void {
  nameRegistry.clear();
}

// ---------------------------------------------------------------------------
// Layer 2: Kind Handler Registry (spec §11.2 — per-kind handlers)
// ---------------------------------------------------------------------------

const toolHandlers = new Map<string, ToolHandler>();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register a {@link ToolHandler} for a given tool `kind`.
 *
 * @param kind - The tool kind string (e.g., "prompty", "mcp").
 * @param handler - The handler implementation.
 */
export function registerToolHandler(kind: string, handler: ToolHandler): void {
  toolHandlers.set(kind, handler);
}

/**
 * Look up a registered {@link ToolHandler} by kind.
 *
 * @param kind - The tool kind to look up.
 * @returns The registered handler.
 * @throws {ToolHandlerError} If no handler is registered for the kind.
 */
export function getToolHandler(kind: string): ToolHandler {
  const h = toolHandlers.get(kind);
  if (!h) throw new ToolHandlerError(kind);
  return h;
}

/**
 * Clear all registered tool handlers. Useful in tests.
 */
export function clearToolHandlers(): void {
  toolHandlers.clear();
}

// ---------------------------------------------------------------------------
// Built-in handlers
// ---------------------------------------------------------------------------

/**
 * Handles `kind: "function"` tools. Function tools need a user-provided
 * callable in userTools or the name registry. If dispatch reaches this
 * handler, it means no callable was found — emit a helpful error.
 */
class FunctionToolHandler implements ToolHandler {
  async executeTool(
    tool: Record<string, unknown>,
    _args: Record<string, unknown>,
    _agent: Prompty,
    _parentInputs: Record<string, unknown>,
  ): Promise<string> {
    const name = (tool.name as string) ?? "unknown";
    throw new Error(
      `Function tool '${name}' declared but no callable provided. ` +
        `Pass it via tools: { '${name}': fn } in executeAgent().`,
    );
  }
}

/**
 * Handles `kind: "prompty"` tools by loading a child `.prompty` file
 * relative to the parent agent and executing it.
 *
 * - `mode === "single"` (default): `prepare()` → `run()`
 * - `mode === "agentic"`: `executeAgent()`
 */
class PromptyToolHandler implements ToolHandler {
  async executeTool(
    tool: Record<string, unknown>,
    args: Record<string, unknown>,
    agent: Prompty,
    _parentInputs: Record<string, unknown>,
  ): Promise<string> {
    // Dynamic imports to break circular dependency with pipeline.ts
    const { load } = await import("./loader.js");
    const { prepare, run, executeAgent } = await import("./pipeline.js");

    const parentPath = (agent.metadata ?? {}).__source_path as string | undefined;
    if (!parentPath) {
      return `Error: cannot resolve PromptyTool '${tool.name}': parent has no __source_path`;
    }

    const childPath = resolve(dirname(parentPath), tool.path as string);

    try {
      const child = load(childPath);
      const mode = (tool.mode as string) ?? "single";

      if (mode === "agentic") {
        const result = await executeAgent(child, args);
        return typeof result === "string" ? result : JSON.stringify(result);
      } else {
        const messages = await prepare(child, args);
        const result = await run(child, messages);
        return typeof result === "string" ? result : JSON.stringify(result);
      }
    } catch (err) {
      return `Error executing PromptyTool '${tool.name}': ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

/**
 * Placeholder handler for `kind: "mcp"` tools.
 * MCP tool dispatch is not yet implemented.
 */
class McpToolHandler implements ToolHandler {
  async executeTool(
    _tool: Record<string, unknown>,
    _args: Record<string, unknown>,
    _agent: Prompty,
    _parentInputs: Record<string, unknown>,
  ): Promise<string> {
    throw new Error("MCP tool dispatch is not yet implemented");
  }
}

/**
 * Placeholder handler for `kind: "openapi"` tools.
 * OpenAPI tool dispatch is not yet implemented.
 */
class OpenApiToolHandler implements ToolHandler {
  async executeTool(
    _tool: Record<string, unknown>,
    _args: Record<string, unknown>,
    _agent: Prompty,
    _parentInputs: Record<string, unknown>,
  ): Promise<string> {
    throw new Error("OpenAPI tool dispatch is not yet implemented");
  }
}

/**
 * Placeholder handler for `kind: "*"` (custom) tools.
 * Custom tool dispatch is not yet implemented.
 */
class CustomToolHandler implements ToolHandler {
  async executeTool(
    _tool: Record<string, unknown>,
    _args: Record<string, unknown>,
    _agent: Prompty,
    _parentInputs: Record<string, unknown>,
  ): Promise<string> {
    throw new Error("Custom tool dispatch is not yet implemented");
  }
}

// ---------------------------------------------------------------------------
// Main dispatch function
// ---------------------------------------------------------------------------

/**
 * Dispatch a tool call to the appropriate handler.
 *
 * Resolution order:
 * 1. User-supplied tool functions (`userTools[toolName]`)
 * 2. Declarative tools on `agent.tools` looked up by name, dispatched
 *    to the registered {@link ToolHandler} for the tool's `kind`
 *
 * Errors are caught and returned as strings — this function never throws,
 * so the agent loop can continue processing.
 *
 * @param toolName - The name of the tool to execute.
 * @param args - Parsed arguments for the tool.
 * @param userTools - User-supplied tool function map.
 * @param agent - The parent Prompty agent.
 * @param parentInputs - The original inputs passed to the parent agent.
 * @returns The tool result as a string.
 */
export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  userTools: Record<string, (...args: unknown[]) => unknown>,
  agent: Prompty,
  parentInputs: Record<string, unknown>,
): Promise<string> {
  try {
    // 1. Check user-supplied tool functions first (per-call override)
    const userFn = userTools[toolName];
    if (userFn) {
      const result = await userFn(args);
      return typeof result === "string" ? result : JSON.stringify(result);
    }

    // 2. Check global name registry (spec §11.2 Layer 1)
    const registeredFn = getTool(toolName);
    if (registeredFn) {
      const result = await registeredFn(args);
      return typeof result === "string" ? result : JSON.stringify(result);
    }

    // 3. Look up declarative tool on agent.tools by name → kind handler (Layer 2)
    const tool = agent.tools?.find((t) => t.name === toolName);
    if (!tool) {
      const available = Object.keys(userTools).sort().join(", ") || "(none)";
      return `Error: tool "${toolName}" not found in userTools or agent.tools. Available user tools: ${available}`;
    }

    const kind = tool.kind || "*";
    let handler: ToolHandler;
    try {
      handler = getToolHandler(kind);
    } catch {
      // Fall back to wildcard handler
      try {
        handler = getToolHandler("*");
      } catch {
        return `Error: no handler registered for tool kind '${kind}' (tool '${toolName}')`;
      }
    }
    return await handler.executeTool(
      tool as unknown as Record<string, unknown>,
      args,
      agent,
      parentInputs,
    );
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// Auto-register built-in handlers
// ---------------------------------------------------------------------------

registerToolHandler("function", new FunctionToolHandler());
registerToolHandler("prompty", new PromptyToolHandler());
registerToolHandler("mcp", new McpToolHandler());
registerToolHandler("openapi", new OpenApiToolHandler());
registerToolHandler("*", new CustomToolHandler());

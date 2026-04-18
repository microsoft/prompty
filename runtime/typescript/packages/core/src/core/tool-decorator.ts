/**
 * `tool()` wrapper for typed tool functions (spec §11.2).
 *
 * Creates a FunctionTool definition from a function's metadata and
 * auto-registers it in the global tool name registry.
 *
 * @module
 */

import { FunctionTool } from "../model/tools/tool.js";
import { Property } from "../model/core/property.js";
import { registerTool } from "./tool-dispatch.js";

/** Options for the tool() wrapper. */
export interface ToolOptions {
  /** Override the tool name (defaults to fn.name). */
  name?: string;
  /** Override the description. */
  description?: string;
  /** Parameter definitions (since JS can't introspect type hints). */
  parameters?: ToolParameter[];
  /** If false, skip global registration. Default: true. */
  register?: boolean;
}

/** A parameter definition for a tool function. */
export interface ToolParameter {
  name: string;
  kind?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

/** Extended function with __tool__ metadata. */
export interface ToolFunction<T extends (...args: unknown[]) => unknown = (...args: unknown[]) => unknown> {
  (...args: Parameters<T>): ReturnType<T>;
  __tool__: FunctionTool;
}

/**
 * Wrap a function as a typed tool.
 *
 * Unlike Python's @tool which can introspect type hints, the JS version
 * requires explicit parameter definitions. The function itself is returned
 * unchanged but with a `__tool__` property containing the FunctionTool.
 *
 * @example
 * ```ts
 * const getWeather = tool(
 *   (city: string, units?: string) => `72°F in ${city}`,
 *   {
 *     name: "get_weather",
 *     description: "Get the current weather",
 *     parameters: [
 *       { name: "city", kind: "string", required: true },
 *       { name: "units", kind: "string", default: "celsius" },
 *     ],
 *   },
 * );
 *
 * getWeather.__tool__; // FunctionTool instance
 * getWeather("NYC");   // "72°F in NYC"
 * ```
 */
export function tool<T extends (...args: unknown[]) => unknown>(
  fn: T,
  options?: ToolOptions,
): ToolFunction<T> {
  const toolName = options?.name ?? fn.name;
  const toolDesc = options?.description ?? "";
  const shouldRegister = options?.register !== false;

  const properties: Property[] = (options?.parameters ?? []).map((p) =>
    new Property({
      name: p.name,
      kind: p.kind ?? "string",
      required: p.required ?? (p.default === undefined),
      description: p.description,
      default: p.default,
    }),
  );

  const toolDef = new FunctionTool({
    name: toolName,
    kind: "function",
    description: toolDesc,
    parameters: properties,
  });

  // Attach __tool__ to the function
  const wrapped = fn as unknown as ToolFunction<T>;
  (wrapped as unknown as Record<string, unknown>).__tool__ = toolDef;

  if (shouldRegister) {
    registerTool(toolName, fn as (...args: unknown[]) => unknown);
  }

  return wrapped;
}

/**
 * Validate tool handlers against an agent's tool declarations and return a handler record.
 *
 * Each function must have a `__tool__` property (set by `tool()`). `bindTools` matches
 * each handler's name against `kind: "function"` tools declared in `agent.tools`,
 * raising on mismatches and warning on missing handlers.
 *
 * @param agent - A loaded Prompty agent (has `.tools` property)
 * @param tools - Array of `tool()`-wrapped functions
 * @returns Handler record suitable for `turn(..., { tools: result })`
 * @throws Error if a handler has no `__tool__` property or no matching declaration
 */
export function bindTools(
  agent: { tools?: Array<{ name: string; kind?: string }> },
  tools: Array<ToolFunction>,
): Record<string, (...args: unknown[]) => unknown> {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};

  for (const fn of tools) {
    const toolDef = fn.__tool__;
    if (!toolDef) {
      throw new Error(
        `Function '${fn.name || "(anonymous)"}' is not a tool()-wrapped function (missing __tool__ property)`,
      );
    }
    const name = toolDef.name;
    if (name in handlers) {
      throw new Error(`Duplicate tool handler: '${name}'`);
    }
    handlers[name] = fn as (...args: unknown[]) => unknown;
  }

  // Get declared function tool names from agent.tools
  const declaredFunctionTools = new Set<string>();
  for (const toolDef of agent.tools ?? []) {
    if (toolDef.kind === "function") {
      declaredFunctionTools.add(toolDef.name);
    }
  }

  // Validate: every handler must match a declaration
  for (const name of Object.keys(handlers)) {
    if (!declaredFunctionTools.has(name)) {
      const declared = [...declaredFunctionTools].sort().join(", ") || "(none)";
      throw new Error(
        `Tool handler '${name}' has no matching 'kind: function' declaration in agent.tools. ` +
          `Declared function tools: ${declared}`,
      );
    }
  }

  // Warn: every function declaration should have a handler
  for (const name of declaredFunctionTools) {
    if (!(name in handlers)) {
      console.warn(
        `Tool '${name}' is declared in agent.tools but no handler was provided to bindTools()`,
      );
    }
  }

  return handlers;
}

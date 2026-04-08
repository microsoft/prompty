/**
 * `tool()` wrapper for typed tool functions (spec §11.2).
 *
 * Creates a FunctionTool definition from a function's metadata and
 * auto-registers it in the global tool name registry.
 *
 * @module
 */

import { FunctionTool } from "../model/tool.js";
import { Property } from "../model/property.js";
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

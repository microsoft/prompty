/**
 * Plugin interfaces for the Prompty pipeline.
 *
 * Each pipeline step is defined as an interface. Implementations are
 * registered via the registry and discovered at runtime by key
 * (e.g., "nunjucks" for renderers, "openai" for executors).
 *
 * @module
 */

import type { Prompty } from "../model/prompty.js";
import type { Message } from "./types.js";

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Renders a template string with the given inputs.
 *
 * Discovered by: `agent.template.format.kind` (e.g., "nunjucks", "mustache").
 */
export interface Renderer {
  render(agent: Prompty, template: string, inputs: Record<string, unknown>): Promise<string>;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parses a rendered string into an array of abstract Messages.
 *
 * Discovered by: `agent.template.parser.kind` (e.g., "prompty").
 *
 * Optionally implements `preRender()` for nonce injection (strict mode).
 */
export interface Parser {
  parse(agent: Prompty, rendered: string, context?: Record<string, unknown>): Promise<Message[]>;

  /**
   * Optional hook called before rendering to sanitize the template
   * and produce context used during parsing.
   *
   * Returns `[sanitizedTemplate, context]`.
   */
  preRender?(template: string): [string, Record<string, unknown>];
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Sends messages to an LLM provider and returns the raw response.
 *
 * Discovered by: `agent.model.provider` (e.g., "openai", "azure").
 */
export interface Executor {
  execute(agent: Prompty, messages: Message[]): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

/**
 * Extracts clean results from raw LLM responses.
 *
 * Discovered by: `agent.model.provider` (e.g., "openai", "azure").
 */
export interface Processor {
  process(agent: Prompty, response: unknown): Promise<unknown>;
}

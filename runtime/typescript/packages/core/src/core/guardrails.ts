/**
 * §13.4 Guardrails — optional validation hooks for the agent loop.
 * @module
 */

import { Message } from "./types.js";

/** Result of a guardrail check. */
export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
  rewrite?: any;
}

/** Error thrown when a guardrail denies the operation. */
export class GuardrailError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`Guardrail denied: ${reason}`);
    this.name = "GuardrailError";
    this.reason = reason;
  }
}

/** Input guardrail hook signature. */
export type InputGuardrail = (messages: Message[]) => GuardrailResult;
/** Output guardrail hook signature. */
export type OutputGuardrail = (message: Message) => GuardrailResult;
/** Tool guardrail hook signature. */
export type ToolGuardrail = (name: string, args: Record<string, unknown>) => GuardrailResult;

/** Configuration for guardrail hooks. */
export interface GuardrailsOptions {
  input?: InputGuardrail;
  output?: OutputGuardrail;
  tool?: ToolGuardrail;
}

/**
 * Guardrails with input, output, and tool hooks.
 * All hooks are optional — when not set, execution proceeds normally.
 */
export class Guardrails {
  private inputHook?: InputGuardrail;
  private outputHook?: OutputGuardrail;
  private toolHook?: ToolGuardrail;

  constructor(options?: GuardrailsOptions) {
    this.inputHook = options?.input;
    this.outputHook = options?.output;
    this.toolHook = options?.tool;
  }

  checkInput(messages: Message[]): GuardrailResult {
    if (!this.inputHook) return { allowed: true };
    return this.inputHook(messages);
  }

  checkOutput(message: Message): GuardrailResult {
    if (!this.outputHook) return { allowed: true };
    return this.outputHook(message);
  }

  checkTool(name: string, args: Record<string, unknown>): GuardrailResult {
    if (!this.toolHook) return { allowed: true };
    return this.toolHook(name, args);
  }
}

/**
 * Anthropic executor — placeholder for future Anthropic API integration.
 *
 * @module
 */

import type { PromptAgent } from "agentschema";
import type { Executor, Message } from "@prompty/core";

export class AnthropicExecutor implements Executor {
  async execute(agent: PromptAgent, messages: Message[]): Promise<unknown> {
    throw new Error(
      "AnthropicExecutor is not yet implemented. " +
        "Install a future version of @prompty/anthropic for Anthropic API support, " +
        "or use @prompty/openai with Anthropic's OpenAI-compatible endpoint.",
    );
  }
}

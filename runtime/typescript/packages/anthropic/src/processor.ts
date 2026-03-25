/**
 * Anthropic processor — placeholder for future Anthropic response processing.
 *
 * @module
 */

import type { PromptAgent } from "agentschema";
import type { Processor } from "@prompty/core";

export class AnthropicProcessor implements Processor {
  async process(agent: PromptAgent, response: unknown): Promise<unknown> {
    throw new Error(
      "AnthropicProcessor is not yet implemented. " +
        "Install a future version of @prompty/anthropic for Anthropic API support.",
    );
  }
}

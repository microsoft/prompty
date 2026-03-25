/**
 * Foundry processor — identical to OpenAI processor.
 *
 * Foundry returns OpenAI-compatible responses via getOpenAIClient().
 *
 * @module
 */

import type { PromptAgent } from "agentschema";
import type { Processor } from "@prompty/core";
import { processResponse } from "@prompty/openai";
import { traceSpan } from "@prompty/core";

export class FoundryProcessor implements Processor {
  async process(agent: PromptAgent, response: unknown): Promise<unknown> {
    return traceSpan("FoundryProcessor.process", async () => {
      return processResponse(agent, response);
    });
  }
}

/**
 * Foundry processor — identical to OpenAI processor.
 *
 * Foundry returns OpenAI-compatible responses via getOpenAIClient().
 *
 * @module
 */

import type { Prompty } from "@prompty/core";
import type { Processor } from "@prompty/core";
import { processResponse } from "@prompty/openai";
import { traceSpan } from "@prompty/core";

export class FoundryProcessor implements Processor {
  async process(agent: Prompty, response: unknown): Promise<unknown> {
    return traceSpan("FoundryProcessor.process", async () => {
      return processResponse(agent, response);
    });
  }
}

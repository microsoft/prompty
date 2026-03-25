/**
 * Foundry processor — identical to OpenAI processor.
 *
 * Foundry returns OpenAI-compatible responses via getOpenAIClient().
 *
 * @module
 */

import type { PromptAgent } from "agentschema";
import type { Processor } from "../../core/interfaces.js";
import { processResponse } from "../openai/processor.js";
import { traceSpan } from "../../tracing/tracer.js";

export class FoundryProcessor implements Processor {
  async process(agent: PromptAgent, response: unknown): Promise<unknown> {
    return traceSpan("FoundryProcessor.process", async () => {
      return processResponse(agent, response);
    });
  }
}

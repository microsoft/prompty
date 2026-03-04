/**
 * Azure OpenAI processor — identical to OpenAI processor.
 *
 * Azure uses the same response format as OpenAI.
 *
 * @module
 */

import type { PromptAgent } from "agentschema";
import type { Processor } from "../../core/interfaces.js";
import { processResponse } from "../openai/processor.js";
import { traceSpan } from "../../tracing/tracer.js";

export class AzureProcessor implements Processor {
  async process(agent: PromptAgent, response: unknown): Promise<unknown> {
    return traceSpan("AzureProcessor.process", async (emit) => {
      return processResponse(agent, response);
    });
  }
}

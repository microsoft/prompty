/**
 * Azure OpenAI processor — identical to OpenAI processor.
 *
 * Azure uses the same response format as OpenAI.
 *
 * @module
 */

import type { Agent } from "@prompty/core";
import type { Processor } from "@prompty/core";
import { processResponse } from "@prompty/openai";
import { traceSpan } from "@prompty/core";

export class AzureProcessor implements Processor {
  async process(agent: Agent, response: unknown): Promise<unknown> {
    return traceSpan("AzureProcessor", async (emit) => {
      emit("signature", "prompty.azure.processor.AzureProcessor.invoke");
      emit("inputs", { data: response });
      const result = processResponse(agent, response);
      emit("result", result);
      return result;
    });
  }
}

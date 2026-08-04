package com.microsoft.prompty.foundry;

import com.microsoft.prompty.openai.OpenAIProcessor;

/**
 * Reads Azure OpenAI and Foundry responses.
 *
 * <p>Azure returns OpenAI's response shape, so all of the reading is inherited. Only the provider
 * name changes, and the fact that none of Azure's endpoints hand back a handle that would let a
 * later request resume model-visible state — so the conversation is retained as explicitly portable
 * context instead of a continuation the provider could not honour.
 */
public class FoundryProcessor extends OpenAIProcessor {

  @Override
  protected String providerName() {
    return "foundry";
  }

  @Override
  protected boolean supportsResponsesContinuation() {
    return false;
  }
}

package com.microsoft.prompty.openai;

import com.microsoft.prompty.PromptyExtension;

/**
 * Registers the OpenAI provider.
 *
 * <p>Discovered through {@code ServiceLoader}, so putting this module on the classpath is all it
 * takes for {@code provider: openai} prompts to run — no registration call in application code.
 */
public final class OpenAIExtension implements PromptyExtension {

  @Override
  public void register(Registrar registrar) {
    registrar.executor("openai", new OpenAIExecutor()).processor("openai", new OpenAIProcessor());
  }
}

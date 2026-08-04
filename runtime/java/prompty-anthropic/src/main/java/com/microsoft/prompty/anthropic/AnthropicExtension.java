package com.microsoft.prompty.anthropic;

import com.microsoft.prompty.PromptyExtension;

/**
 * Registers the Anthropic provider.
 *
 * <p>Discovered through {@code ServiceLoader}, so putting this module on the classpath is all it
 * takes for {@code provider: anthropic} prompts to run — no registration call in application code.
 */
public final class AnthropicExtension implements PromptyExtension {

  @Override
  public void register(Registrar registrar) {
    registrar
        .executor("anthropic", new AnthropicExecutor())
        .processor("anthropic", new AnthropicProcessor());
  }
}

package com.microsoft.prompty.foundry;

import com.microsoft.prompty.PromptyExtension;

/**
 * Registers the Foundry provider.
 *
 * <p>Discovered through {@code ServiceLoader}, so putting this module on the classpath is all it
 * takes for {@code provider: foundry} prompts to run — no registration call in application code.
 */
public final class FoundryExtension implements PromptyExtension {

  @Override
  public void register(Registrar registrar) {
    registrar.executor("foundry", new FoundryExecutor()).processor("foundry", new FoundryProcessor());
  }
}

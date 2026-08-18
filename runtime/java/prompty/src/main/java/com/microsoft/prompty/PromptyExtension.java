package com.microsoft.prompty;

/**
 * Service-provider interface for contributing invokers to the {@link Registry}.
 *
 * <p>An implementation is discovered through {@link java.util.ServiceLoader}, so a provider module
 * becomes available simply by being on the classpath. Declare it in
 * {@code META-INF/services/com.microsoft.prompty.PromptyExtension}, or as a {@code provides} clause
 * in a module descriptor.
 *
 * <p>One extension may register any number of invokers under any number of keys, which is what lets
 * a single provider module serve several closely related back ends.
 */
public interface PromptyExtension {

  /** Contribute this extension's invokers. Called once, the first time the registry is used. */
  void register(Registrar registrar);

  /** The subset of the registry an extension is allowed to write to. */
  interface Registrar {

    /** Register a renderer under a template-format key such as {@code "nunjucks"}. */
    Registrar renderer(String key, Renderer renderer);

    /** Register a parser under a template-parser key such as {@code "prompty"}. */
    Registrar parser(String key, Parser parser);

    /** Register an executor under a provider key such as {@code "openai"}. */
    Registrar executor(String key, Executor executor);

    /** Register a processor under a provider key such as {@code "openai"}. */
    Registrar processor(String key, Processor processor);
  }
}

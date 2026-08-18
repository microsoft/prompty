package com.microsoft.prompty;

import com.microsoft.prompty.parsers.PromptyChatParser;
import com.microsoft.prompty.renderers.JinjaRenderer;
import com.microsoft.prompty.renderers.MustacheRenderer;
import java.util.Map;
import java.util.ServiceLoader;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The process-wide lookup of pipeline invokers, keyed by group and name.
 *
 * <p>Four independent groups are held: renderers keyed by template format, parsers keyed by template
 * parser, and executors and processors keyed by model provider. The keys come straight from a
 * loaded agent, which is what lets a {@code .prompty} file select its own pipeline without the
 * caller wiring anything up.
 *
 * <p>The registry populates itself on first use: the built-in renderers and parser are registered
 * directly, then every {@link PromptyExtension} on the classpath is given a chance to contribute.
 * Explicit {@code register*} calls always win over discovery, so a test or an embedding application
 * can substitute a fake without removing the real provider from the classpath.
 */
public final class Registry {

  private static final Map<String, Renderer> RENDERERS = new ConcurrentHashMap<>();
  private static final Map<String, Parser> PARSERS = new ConcurrentHashMap<>();
  private static final Map<String, Executor> EXECUTORS = new ConcurrentHashMap<>();
  private static final Map<String, Processor> PROCESSORS = new ConcurrentHashMap<>();

  private static final Object BOOTSTRAP_LOCK = new Object();
  private static volatile boolean bootstrapped = false;

  private Registry() {}

  // ---------------------------------------------------------------- registration

  /** Register a renderer under a template-format key. */
  public static void registerRenderer(String key, Renderer renderer) {
    bootstrap();
    RENDERERS.put(key, renderer);
  }

  /** Register a parser under a template-parser key. */
  public static void registerParser(String key, Parser parser) {
    bootstrap();
    PARSERS.put(key, parser);
  }

  /** Register an executor under a model-provider key. */
  public static void registerExecutor(String key, Executor executor) {
    bootstrap();
    EXECUTORS.put(key, executor);
  }

  /** Register a processor under a model-provider key. */
  public static void registerProcessor(String key, Processor processor) {
    bootstrap();
    PROCESSORS.put(key, processor);
  }

  // ---------------------------------------------------------------- lookup

  public static boolean hasRenderer(String key) {
    bootstrap();
    return RENDERERS.containsKey(key);
  }

  public static boolean hasParser(String key) {
    bootstrap();
    return PARSERS.containsKey(key);
  }

  public static boolean hasExecutor(String key) {
    bootstrap();
    return EXECUTORS.containsKey(key);
  }

  public static boolean hasProcessor(String key) {
    bootstrap();
    return PROCESSORS.containsKey(key);
  }

  /**
   * The renderer registered under {@code key}.
   *
   * @throws InvokerException with {@link InvokerException.Kind#NOT_FOUND} if none is registered
   */
  public static Renderer renderer(String key) {
    bootstrap();
    Renderer renderer = RENDERERS.get(key);
    if (renderer == null) {
      throw InvokerException.notFound("renderer", key);
    }
    return renderer;
  }

  /**
   * The parser registered under {@code key}.
   *
   * @throws InvokerException with {@link InvokerException.Kind#NOT_FOUND} if none is registered
   */
  public static Parser parser(String key) {
    bootstrap();
    Parser parser = PARSERS.get(key);
    if (parser == null) {
      throw InvokerException.notFound("parser", key);
    }
    return parser;
  }

  /**
   * The executor registered under {@code key}.
   *
   * @throws InvokerException with {@link InvokerException.Kind#NOT_FOUND} if none is registered
   */
  public static Executor executor(String key) {
    bootstrap();
    Executor executor = EXECUTORS.get(key);
    if (executor == null) {
      throw InvokerException.notFound("executor", key);
    }
    return executor;
  }

  /**
   * The processor registered under {@code key}.
   *
   * @throws InvokerException with {@link InvokerException.Kind#NOT_FOUND} if none is registered
   */
  public static Processor processor(String key) {
    bootstrap();
    Processor processor = PROCESSORS.get(key);
    if (processor == null) {
      throw InvokerException.notFound("processor", key);
    }
    return processor;
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Drop every registration and force rediscovery on next use.
   *
   * <p>Intended for tests that install fakes and must not leak them into later tests.
   */
  public static void clearCache() {
    synchronized (BOOTSTRAP_LOCK) {
      RENDERERS.clear();
      PARSERS.clear();
      EXECUTORS.clear();
      PROCESSORS.clear();
      bootstrapped = false;
    }
  }

  /** Populate the registry if it has not been populated since the last {@link #clearCache()}. */
  public static void bootstrap() {
    if (bootstrapped) {
      return;
    }
    synchronized (BOOTSTRAP_LOCK) {
      if (bootstrapped) {
        return;
      }
      // Set first: a discovered extension may itself call into the registry, and re-entering
      // bootstrap would deadlock on this lock's non-reentrant intent or recurse indefinitely.
      bootstrapped = true;
      registerBuiltins();
      loadExtensions();
    }
  }

  private static void registerBuiltins() {
    Renderer jinja = new JinjaRenderer();
    // Nunjucks is the canonical format name in the spec; jinja2 is the long-standing alias used by
    // existing .prompty files. Both resolve to the same engine.
    RENDERERS.put("nunjucks", jinja);
    RENDERERS.put("jinja2", jinja);
    RENDERERS.put("mustache", new MustacheRenderer());
    PARSERS.put("prompty", new PromptyChatParser());
  }

  private static void loadExtensions() {
    Registrar registrar = new Registrar();
    for (PromptyExtension extension : ServiceLoader.load(PromptyExtension.class)) {
      extension.register(registrar);
    }
  }

  private static final class Registrar implements PromptyExtension.Registrar {
    @Override
    public PromptyExtension.Registrar renderer(String key, Renderer renderer) {
      RENDERERS.put(key, renderer);
      return this;
    }

    @Override
    public PromptyExtension.Registrar parser(String key, Parser parser) {
      PARSERS.put(key, parser);
      return this;
    }

    @Override
    public PromptyExtension.Registrar executor(String key, Executor executor) {
      EXECUTORS.put(key, executor);
      return this;
    }

    @Override
    public PromptyExtension.Registrar processor(String key, Processor processor) {
      PROCESSORS.put(key, processor);
      return this;
    }
  }
}

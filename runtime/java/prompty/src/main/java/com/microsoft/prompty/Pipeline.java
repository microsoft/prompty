package com.microsoft.prompty;

import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelOptions;
import com.microsoft.prompty.model.Property;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.StreamChunk;
import com.microsoft.prompty.model.Template;
import com.microsoft.prompty.model.ToolCall;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The prompt execution pipeline: render, parse, execute, process.
 *
 * <p>Each stage resolves its implementation from the {@link Registry} using a key taken from the
 * agent itself — template format for the renderer, template parser for the parser, model provider
 * for the executor and processor. Nothing here knows about any specific template engine or model
 * vendor, which is what lets a {@code .prompty} file choose its own pipeline.
 *
 * <p>The stages compose into three entry points of increasing scope: {@link #prepare} turns an agent
 * plus inputs into messages, {@link #run} turns messages into a result, and {@link #invoke} does
 * both.
 */
public final class Pipeline {

  private static final String DEFAULT_FORMAT = "nunjucks";
  private static final String DEFAULT_PARSER = "prompty";
  private static final String DEFAULT_PROVIDER = "openai";

  private Pipeline() {}

  // ---------------------------------------------------------------- configuration

  /** The template-format key an agent's renderer is looked up under. */
  public static String formatKind(Prompty agent) {
    Template template = agent == null ? null : agent.template;
    if (template != null && template.format != null && !isBlank(template.format.kind)) {
      return template.format.kind;
    }
    return DEFAULT_FORMAT;
  }

  /** The template-parser key an agent's parser is looked up under. */
  public static String parserKind(Prompty agent) {
    Template template = agent == null ? null : agent.template;
    if (template != null && template.parser != null && !isBlank(template.parser.kind)) {
      return template.parser.kind;
    }
    return DEFAULT_PARSER;
  }

  /** The provider key an agent's executor and processor are looked up under. */
  public static String provider(Prompty agent) {
    if (agent != null && agent.model != null && !isBlank(agent.model.provider)) {
      return agent.model.provider;
    }
    return DEFAULT_PROVIDER;
  }

  /**
   * Whether injection defence is active.
   *
   * <p>Defaults to on. A prompt is only as trustworthy as its weakest input, so opting out has to be
   * a deliberate act recorded in the file.
   */
  public static boolean isStrict(Prompty agent) {
    Template template = agent == null ? null : agent.template;
    if (template != null && template.format != null && template.format.strict != null) {
      return template.format.strict;
    }
    return true;
  }

  /** Whether the agent asks for a streamed response. */
  public static boolean isStreaming(Prompty agent) {
    ModelOptions options = agent == null || agent.model == null ? null : agent.model.options;
    if (options == null || options.additionalProperties == null) {
      return false;
    }
    return Boolean.TRUE.equals(options.additionalProperties.get("stream"));
  }

  // ---------------------------------------------------------------- inputs

  /**
   * Fill in defaults and check that every required input is present.
   *
   * @throws InvokerException with {@link InvokerException.Kind#VALIDATION} if a required input is
   *     missing
   */
  public static Map<String, Object> validateInputs(Prompty agent, Map<String, Object> inputs) {
    Map<String, Object> result = new LinkedHashMap<>(inputs == null ? Map.of() : inputs);
    List<Property> properties = agent == null ? null : agent.inputs;
    if (properties == null) {
      return result;
    }

    for (Property property : properties) {
      if (property == null || isBlank(property.name) || result.containsKey(property.name)) {
        continue;
      }
      if (property.defaultValue != null) {
        result.put(property.name, property.defaultValue);
      } else if (Boolean.TRUE.equals(property.required)) {
        throw InvokerException.validation("Missing required input: \"" + property.name + "\"");
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- stages

  /** Render the agent's instructions with the given inputs. */
  public static String render(Prompty agent, Map<String, Object> inputs) {
    return renderWithNonces(agent, agent == null ? "" : agent.instructions, inputs).rendered();
  }

  /** A rendered template together with the thread markers substituted into it. */
  private record Rendered(String rendered, Map<String, String> threadNonces) {}

  private static Rendered renderWithNonces(
      Prompty agent, String template, Map<String, Object> inputs) {
    // Validation happens here rather than only in prepare() so that the public render() entry point
    // also fills defaults and reports missing required inputs. Calling it twice is harmless.
    Nonces.Prepared prepared = Nonces.prepareRenderInputs(agent, validateInputs(agent, inputs));
    String kind = formatKind(agent);

    try (Tracer.Span span = Tracer.start("Renderer")) {
      span.emit("signature", "prompty.renderers." + kind + ".render");
      span.emit("inputs", prepared.inputs());
      try {
        String rendered =
            Registry.renderer(kind).render(agent, template == null ? "" : template, prepared.inputs());
        span.emit("result", rendered);
        return new Rendered(rendered, prepared.threadNonces());
      } catch (RuntimeException e) {
        span.error(e);
        throw e;
      }
    }
  }

  /** Parse rendered text into messages using the agent's registered parser. */
  public static List<Message> parse(Prompty agent, String rendered, Map<String, Object> context) {
    String kind = parserKind(agent);
    try (Tracer.Span span = Tracer.start("Parser")) {
      span.emit("signature", "prompty.parsers." + kind + ".parse");
      span.emit("inputs", rendered);
      try {
        List<Message> messages = Registry.parser(kind).parse(agent, rendered, context);
        span.emit("result", messages);
        return messages;
      } catch (RuntimeException e) {
        span.error(e);
        throw e;
      }
    }
  }

  /**
   * Render, parse, and splice in any thread history.
   *
   * <p>In strict mode the parser is first given a chance to stamp the template's role markers, so
   * that markers appearing later — that is, ones that arrived through an input value — can be told
   * apart from the ones the prompt author wrote.
   */
  public static List<Message> prepare(Prompty agent, Map<String, Object> inputs) {
    try (Tracer.Span span = Tracer.start("prepare")) {
      span.emit("signature", "prompty.prepare");

      Map<String, Object> validated = validateInputs(agent, inputs);
      span.emit("inputs", validated);

      String instructions = agent == null || agent.instructions == null ? "" : agent.instructions;
      String template = instructions;
      Map<String, Object> parseContext = null;

      if (isStrict(agent)) {
        Parser parser = Registry.parser(parserKind(agent));
        java.util.Optional<Parser.PreRender> preRender = parser.preRender(instructions);
        if (preRender.isPresent()) {
          template = preRender.get().template();
          parseContext = preRender.get().context();
        }
      }

      Rendered rendered = renderWithNonces(agent, template, validated);
      List<Message> messages = parse(agent, rendered.rendered(), parseContext);
      List<Message> expanded = Threads.expand(messages, rendered.threadNonces(), validated);

      span.emit("result", expanded);
      return expanded;
    }
  }

  /** Process a raw provider response using the agent's registered processor. */
  public static Object process(Prompty agent, Object response) {
    String key = provider(agent);
    try (Tracer.Span span = Tracer.start("Processor")) {
      span.emit("signature", "prompty.processors." + key + ".process");
      try {
        Object result = StructuredResult.wrapIfNeeded(agent, Registry.processor(key).process(agent, response));
        span.emit("result", result);
        return result;
      } catch (RuntimeException e) {
        span.error(e);
        throw e;
      }
    }
  }

  /**
   * Execute messages against the provider and process the response.
   *
   * <p>When the agent asks for streaming, the stream is consumed to completion and the accumulated
   * text returned, so a streaming agent and a non-streaming one produce the same kind of value here.
   * A provider that cannot stream falls back to a single call rather than failing.
   */
  public static Object run(Prompty agent, List<Message> messages) {
    String key = provider(agent);

    try (Tracer.Span span = Tracer.start("run")) {
      span.emit("signature", "prompty.run");
      span.emit("inputs", messages);

      try {
        Object result;
        if (isStreaming(agent)) {
          result = runStreaming(agent, messages, key);
        } else {
          Object response = Registry.executor(key).execute(agent, messages);
          result = StructuredResult.unwrap(process(agent, response));
        }
        span.emit("result", result);
        return result;
      } catch (RuntimeException e) {
        span.error(e);
        throw e;
      }
    }
  }

  private static Object runStreaming(Prompty agent, List<Message> messages, String key) {
    Iterator<Object> raw;
    try {
      raw = Registry.executor(key).executeStream(agent, messages);
    } catch (InvokerException e) {
      // The provider cannot open a stream, so nothing has been dispatched yet and a plain call is
      // safe. Failures after this point must propagate: the request is already in flight, and
      // retrying it would double-charge the caller and re-run any side effects.
      Object response = Registry.executor(key).execute(agent, messages);
      return StructuredResult.unwrap(process(agent, response));
    }
    Iterator<StreamChunk> chunks = Registry.processor(key).processStream(agent, raw);
    return Streams.consume(chunks, null).text();
  }

  /** Prepare and run in one call. */
  public static Object invoke(Prompty agent, Map<String, Object> inputs) {
    try (Tracer.Span span = Tracer.start("invoke")) {
      span.emit("signature", "prompty.invoke");
      span.emit("description", agent == null ? null : agent.description);
      try {
        Object result = run(agent, prepare(agent, inputs));
        span.emit("result", result);
        return result;
      } catch (RuntimeException e) {
        span.error(e);
        throw e;
      }
    }
  }

  /** Load a {@code .prompty} file and invoke it. */
  public static Object invoke(Path path, Map<String, Object> inputs) {
    return invoke(Loader.load(path), inputs);
  }

  /** Load a {@code .prompty} file and invoke it. */
  public static Object invoke(String path, Map<String, Object> inputs) {
    return invoke(Loader.load(path), inputs);
  }

  // ---------------------------------------------------------------- result inspection

  /**
   * Extract tool calls from a processed result.
   *
   * <p>Every provider's processor reports tool calls the same way — a list of {@code
   * {id, name, arguments}} maps — so callers do not have to branch on provider.
   *
   * @return the calls, or an empty list if the result is not a tool-call round
   */
  public static List<ToolCall> toolCalls(Object result) {
    List<ToolCall> calls = new ArrayList<>();
    if (!(result instanceof List<?> items) || items.isEmpty()) {
      return calls;
    }
    for (Object item : items) {
      if (!(item instanceof Map<?, ?> map)) {
        return new ArrayList<>();
      }
      Object id = map.get("id");
      Object name = map.get("name");
      if (!(id instanceof String) || !(name instanceof String)) {
        return new ArrayList<>();
      }
      ToolCall call = new ToolCall();
      call.id = (String) id;
      call.name = (String) name;
      Object arguments = map.get("arguments");
      call.arguments =
          arguments instanceof String text
              ? text
              : arguments == null ? "" : com.microsoft.prompty.model.TypraJson.stringify(arguments);
      calls.add(call);
    }
    return calls;
  }

  /** The text of a processed result, or null if the result is not plain text. */
  public static String textOf(Object result) {
    return result instanceof String text ? text : null;
  }

  private static boolean isBlank(String value) {
    return value == null || value.isEmpty();
  }
}

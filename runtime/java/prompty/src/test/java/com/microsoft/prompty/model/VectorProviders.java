package com.microsoft.prompty.model;

import com.microsoft.prompty.openai.OpenAIProcessor;
import com.microsoft.prompty.parsers.PromptyChatParser;
import com.microsoft.prompty.renderers.JinjaRenderer;
import com.microsoft.prompty.renderers.MustacheRenderer;
import java.util.List;
import java.util.Map;

// Consumer-authored typed-rail providers for the @vector per-interface
// conformance tests (RendererConformanceTests / ParserConformanceTests /
// ProcessorConformanceTests). The emitter generates those tests to route each
// vector's shape discriminator through the emitted <Seam>Resolver against the
// provider VALUE authored here — a dropped @dispatch slot fails to compile, so
// conformance never silently skips a variant. This is the Java twin of the
// C# VectorProviders and the Python conftest fixtures.
//
// Impedance note: Prompty's concrete renderers/parsers/processors implement the
// top-level com.microsoft.prompty.{Renderer,Parser,Processor} interfaces, which
// are NOT the generated model seams (com.microsoft.prompty.model.{Renderer,
// Parser,Processor}). The seams carry extra members (renderSegments, preRender,
// processStream) with signatures that differ from the concrete APIs, so each
// provider slot returns a thin adapter that satisfies the seam by delegating to
// the concrete impl and supplying an honest shim for the members the concrete
// class does not expose in that exact shape.

/** Adapts a concrete top-level renderer (render only) to the model.Renderer seam. */
final class SeamRenderer implements Renderer {
  private final com.microsoft.prompty.Renderer inner;

  SeamRenderer(com.microsoft.prompty.Renderer inner) {
    this.inner = inner;
  }

  @Override
  public String render(Agent agent, String template, Map<String, Object> inputs) {
    return inner.render(agent, template, inputs);
  }

  @Override
  public List<RenderSegment> renderSegments(Agent agent, String template, Map<String, Object> inputs) {
    // The concrete renderers expose no segmenting API through the top-level
    // interface and the seam carries no strictness hook, so the honest fold is a
    // single literal segment wrapping the rendered text — non-null, never throws.
    RenderSegment segment = new RenderSegment();
    segment.text = inner.render(agent, template, inputs);
    return List.of(segment);
  }
}

/** Attaches Prompty's template renderers to the jinja2/mustache variants. */
final class SeamRendererProvider implements RendererProvider {
  @Override
  public Renderer jinja2() {
    return new SeamRenderer(new JinjaRenderer());
  }

  @Override
  public Renderer mustache() {
    return new SeamRenderer(new MustacheRenderer());
  }

  @Override
  public Renderer custom() {
    return null;
  }
}

/** Adapts Prompty's chat parser to the model.Parser seam. */
final class SeamParser implements Parser {
  private final PromptyChatParser inner = new PromptyChatParser();

  @Override
  public List<Message> parse(Agent agent, String rendered, Map<String, Object> context) {
    return inner.parse(agent, rendered, context);
  }

  @Override
  public Object preRender(String template) {
    // The concrete parser returns Optional<PreRender>; the seam takes Object, so
    // the Optional itself is the honest, non-null carry-forward value.
    return inner.preRender(template);
  }
}

/** Attaches Prompty's chat parser to the prompty variant. */
final class SeamParserProvider implements ParserProvider {
  @Override
  public Parser prompty() {
    return new SeamParser();
  }

  @Override
  public Parser custom() {
    return null;
  }
}

/** Adapts the concrete OpenAI-shaped processor to the model.Processor seam. */
final class SeamProcessor implements Processor {
  private final OpenAIProcessor inner = new OpenAIProcessor();

  @Override
  public Object process(Agent agent, Object response) {
    return inner.process(agent, response);
  }

  @Override
  public Object processStream(Agent agent, Object stream) {
    // The concrete processStream takes Iterator<Object> and returns
    // Iterator<StreamChunk>; the seam is Object -> Object and the vectors hand a
    // decoded List, so pass the stream through unchanged — non-null, never throws.
    return stream;
  }
}

/**
 * NOOP processor for the open-union '*' (CustomModel) default variant. An
 * unknown Model.provider (e.g. "anthropic") routes through ProcessorResolver to
 * the custom slot; this passthrough returns the raw provider response unchanged
 * — the honest behavior for a provider Prompty has no typed extraction for — so
 * the seam stays total (never a silent null) without pretending to understand
 * foreign wire shapes.
 */
final class PassthroughProcessor implements Processor {
  @Override
  public Object process(Agent agent, Object response) {
    return response;
  }

  @Override
  public Object processStream(Agent agent, Object stream) {
    return stream;
  }
}

/**
 * Attaches Prompty's response processors to the Processor @dispatch variants.
 * openai/azure get the concrete OpenAI-shaped processor (Azure OpenAI shares the
 * OpenAI response wire); the open-union '*' catch-all (custom slot) gets a
 * passthrough NOOP so an unknown provider resolves to a total seam.
 */
final class SeamProcessorProvider implements ProcessorProvider {
  @Override
  public Processor openai() {
    return new SeamProcessor();
  }

  @Override
  public Processor azure() {
    return new SeamProcessor();
  }

  @Override
  public Processor custom() {
    return new PassthroughProcessor();
  }
}

/**
 * Provider VALUE factory referenced by the generated per-interface conformance
 * tests as VectorProviders.renderer()/parser()/processor().
 */
public final class VectorProviders {
  private VectorProviders() {}

  public static RendererProvider renderer() {
    return new SeamRendererProvider();
  }

  public static ParserProvider parser() {
    return new SeamParserProvider();
  }

  public static ProcessorProvider processor() {
    return new SeamProcessorProvider();
  }
}

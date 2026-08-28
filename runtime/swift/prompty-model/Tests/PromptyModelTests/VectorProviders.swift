import Foundation

@testable import PromptyModel

// Consumer-authored typed-rail providers for the @vector conformance suites.
// Each generated `*ConformanceTests` file resolves a discriminator against one
// of these providers and invokes the typed seam. The concrete seam impls below
// delegate to the same public pipeline logic the stringly VectorAdapters rail
// uses, so the typed rail and the stringly rail stay behaviorally identical.

// MARK: - Seam implementations

/// Renders through the pipeline dispatch (jinja2 / mustache) keyed off the
/// agent's own `template.format`. Wired to every renderer slot because the
/// pipeline already re-dispatches internally.
struct SeamRenderer: Renderer {
  func render(agent: Agent, template: String, inputs: [String: Any]) async throws -> String {
    var scoped = agent
    scoped.instructions = template
    return try PromptyModel.render(agent: scoped, inputs: inputs).0
  }

  func renderSegments(agent: Agent, template: String, inputs: [String: Any]) async throws
    -> [RenderSegment]
  {
    let segments = try PromptyModel.renderSegments(template: template, inputs: inputs)
    return try segments.map { segment in
      RenderSegment(
        kind: try RenderSegmentKind.parse(segment.kind),
        text: segment.text,
        source: segment.source,
        strict: segment.strict)
    }
  }
}

/// Splits rendered text into role-tagged messages via the prompty chat grammar.
struct SeamParser: Parser {
  func parse(agent: Agent, rendered: String, context: [String: Any]?) async throws -> [Message] {
    parseMessages(rendered)
  }

  func preRender(template: String) throws -> Any? { nil }
}

/// Extracts a clean result from a raw provider response. The provider is read
/// from the nested agent (`agent.model.provider`); `apiType` is flat operational
/// data absent from the typed seam, so it defaults to "chat" — matching the
/// reference typed processor, which dispatches on the response object type rather
/// than apiType. `hasOutputs` derives from the nested `agent.outputs`.
struct SeamProcessor: Processor {
  func process(agent: Agent, response: Any) async throws -> Any {
    var provider = "openai"
    if let model = agent.model, let dict = try? model.save(),
      let value = dict["provider"] as? String, !value.isEmpty
    {
      provider = value
    }
    let hasOutputs = (agent.outputs?.isEmpty == false)
    return processResponse(
      provider: provider, apiType: "chat", response: response, hasOutputs: hasOutputs)
      ?? NSNull()
  }

  func processStream(agent: Agent, stream: Any) async throws -> Any {
    stream
  }
}

/// Total fallback for an unknown discriminator (the declared `*` child slot):
/// returns the payload unchanged rather than failing.
struct PassthroughProcessor: Processor {
  func process(agent: Agent, response: Any) async throws -> Any { response }
  func processStream(agent: Agent, stream: Any) async throws -> Any { stream }
}

// MARK: - Provider registries

private struct SeamRendererProvider: RendererProvider {
  var jinja2: (any Renderer)? { SeamRenderer() }
  var mustache: (any Renderer)? { SeamRenderer() }
  var custom: (any Renderer)? { SeamRenderer() }
}

private struct SeamParserProvider: ParserProvider {
  var prompty: (any Parser)? { SeamParser() }
  var custom: (any Parser)? { SeamParser() }
}

private struct SeamProcessorProvider: ProcessorProvider {
  var openai: (any Processor)? { SeamProcessor() }
  var azure: (any Processor)? { SeamProcessor() }
  var custom: (any Processor)? { PassthroughProcessor() }
}

enum VectorProviders {
  static func renderer() -> any RendererProvider { SeamRendererProvider() }
  static func parser() -> any ParserProvider { SeamParserProvider() }
  static func processor() -> any ProcessorProvider { SeamProcessorProvider() }
}

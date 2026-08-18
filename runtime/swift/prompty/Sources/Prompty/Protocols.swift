import Foundation

/// Pipeline stage conformances.
///
/// The four stage protocols — `Renderer`, `Parser`, `Executor`, and `Processor`
/// — are emitted from the shared TypeSpec model, so this runtime adopts them
/// directly rather than declaring a competing set. This file only supplies the
/// defaults and the small amount of Swift-side typing the generated `Any`
/// signatures leave open.
///
/// Conventions the generated signatures leave to each runtime, matched to the
/// Rust reference implementation:
///
/// - `Executor.executeStream` returns a ``RawChunkStream`` of raw provider
///   chunks — exactly the SSE payloads, undecoded.
/// - `Processor.processStream` turns that raw stream into a ``ChunkStream`` of
///   generated `StreamChunk` models.
/// - `Parser.preRender` returns the rewritten template plus any context the
///   matching `parse` call needs, as `PreRenderResult`.

/// The raw provider chunks an `Executor` streams.
import PromptyModel

/// The decoded chunks a `Processor` streams.

/// What a strict-mode parser hands back from `preRender`.

// MARK: - Generated model ergonomics

public typealias RawChunkStream = AsyncThrowingStream<[String: Any], Error>
public typealias ChunkStream = AsyncThrowingStream<StreamChunk, Error>
public struct PreRenderResult {
  /// The rewritten template to render.
  public var text: String
  /// Context the matching `parse` call needs to validate the render.
  public var context: [String: Any]

  public init(text: String, context: [String: Any]) {
    self.text = text
    self.context = context
  }
}
extension Parser {
  /// Leave the template untouched.
  ///
  /// Only strict-mode parsers need to rewrite instructions before rendering.
  public func preRender(template: String) throws -> Any? { nil }
}
extension Executor {
  /// Report that this provider cannot stream.
  public func executeStream(agent: Agent, messages: [Message]) async throws -> Any {
    throw InvokerError.execution("streaming is not supported by this executor")
  }

  /// Report that this provider has no tool-turn representation.
  public func formatToolMessages(
    rawResponse: Any, toolCalls: [ToolCall], toolResults: [String], textContent: String?
  ) throws -> [Message] {
    throw InvokerError.execution("tool calling is not supported by this executor")
  }
}
extension Processor {
  /// Report that this provider cannot stream.
  public func processStream(stream: Any) async throws -> Any {
    throw InvokerError.execution("streaming is not supported by this processor")
  }
}
extension StreamChunk {
  /// Incremental assistant text.
  public static func text(_ value: String) -> StreamChunk {
    .textChunk(TextChunk(value: value))
  }

  /// A completed tool call.
  public static func tool(_ call: ToolCall) -> StreamChunk {
    .toolChunk(ToolChunk(toolCall: call))
  }

  /// The text carried by this chunk, when it carries any.
  public var textValue: String? {
    if case .textChunk(let chunk) = self { return chunk.value }
    return nil
  }

  /// The tool call carried by this chunk, when it carries one.
  public var toolCallValue: ToolCall? {
    if case .toolChunk(let chunk) = self { return chunk.toolCall }
    return nil
  }
}
extension ToolCall {
  /// Decoded arguments, or an empty dictionary when the payload is unusable.
  public var argumentValues: [String: Any] {
    JSONSupport.parse(json: arguments) as? [String: Any] ?? [:]
  }
}

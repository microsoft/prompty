import Foundation
import PromptyModel

/// Thread-safe lookup tables mapping spec keys to implementations.
///
/// Renderers and parsers are keyed by `template.format.kind` and
/// `template.parser.kind`; executors and processors by `model.provider`.
public final class Registry: @unchecked Sendable {

  /// The registry used by the top-level pipeline functions.
  public static let shared = Registry()

  private let lock = NSLock()
  private var renderers: [String: Renderer] = [:]
  private var parsers: [String: Parser] = [:]
  private var executors: [String: Executor] = [:]
  private var processors: [String: Processor] = [:]

  public init() {}

  // MARK: - Registration

  public func register(renderer: Renderer, for key: String) {
    lock.lock(); defer { lock.unlock() }
    renderers[key] = renderer
  }

  public func register(parser: Parser, for key: String) {
    lock.lock(); defer { lock.unlock() }
    parsers[key] = parser
  }

  public func register(executor: Executor, for key: String) {
    lock.lock(); defer { lock.unlock() }
    executors[key] = executor
  }

  public func register(processor: Processor, for key: String) {
    lock.lock(); defer { lock.unlock() }
    processors[key] = processor
  }

  // MARK: - Lookup

  public func renderer(for key: String) throws -> Renderer {
    lock.lock(); defer { lock.unlock() }
    guard let value = renderers[key] else {
      throw InvokerError.notFound(group: "renderer", key: key)
    }
    return value
  }

  public func parser(for key: String) throws -> Parser {
    lock.lock(); defer { lock.unlock() }
    guard let value = parsers[key] else {
      throw InvokerError.notFound(group: "parser", key: key)
    }
    return value
  }

  public func executor(for key: String) throws -> Executor {
    lock.lock(); defer { lock.unlock() }
    guard let value = executors[key] else {
      throw InvokerError.notFound(group: "executor", key: key)
    }
    return value
  }

  public func processor(for key: String) throws -> Processor {
    lock.lock(); defer { lock.unlock() }
    guard let value = processors[key] else {
      throw InvokerError.notFound(group: "processor", key: key)
    }
    return value
  }

  // MARK: - Defaults

  private var defaultsRegistered = false

  /// Register the renderers and parsers built into the core runtime.
  ///
  /// Providers register themselves — importing `PromptyOpenAI` and calling its
  /// `registerOpenAI()` adds the OpenAI executor and processor.
  ///
  /// The lock is held across the whole installation. Publishing the flag first
  /// and registering afterwards would let a concurrent caller observe
  /// "registered" and then look up an empty table.
  public func registerDefaults() {
    lock.lock(); defer { lock.unlock() }
    guard !defaultsRegistered else { return }
    defaultsRegistered = true

    let jinja = Jinja2Renderer()
    renderers["jinja2"] = jinja
    // `nunjucks` is the JavaScript port of the same template language.
    renderers["nunjucks"] = jinja
    renderers["mustache"] = MustacheRenderer()
    parsers["prompty"] = PromptyChatParser()
  }
}

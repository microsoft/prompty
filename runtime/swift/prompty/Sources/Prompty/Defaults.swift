/// Cross-runtime constants. These values are part of the Agent spec and must
/// match every other runtime exactly.
public enum Defaults {
  /// Renderer key used when `template.format.kind` is absent or empty.
  public static let templateFormat = "jinja2"

  /// Parser key used when `template.parser.kind` is absent or empty.
  public static let parser = "prompty"

  /// Provider key used when `model.provider` is absent or empty.
  public static let provider = "openai"

  /// Injected discriminator — a `.prompty` file is always a prompt.
  public static let kind = "prompt"

  /// Metadata key holding the file a prompt was loaded from.
  public static let sourcePathKey = "__source_path"

  /// Marker key identifying a wrapped structured result.
  public static let structuredMarker = "__prompty_structured"

  /// Prefix of a rich-input nonce placeholder.
  public static let threadNoncePrefix = "__PROMPTY_THREAD_"

  /// Input kinds replaced by nonce placeholders during rendering.
  public static let richKinds: Set<String> = ["thread", "image", "file", "audio"]

  /// Role markers the Agent parser recognizes.
  public static let roleMarkers: Set<String> = ["system", "user", "assistant", "developer"]
}

import "@typra/emitter";

namespace Prompty;

/**
 * Positional marker for conversation history insertion during template rendering.
 *
 * During `prepare()`, nonce strings in rendered text are replaced with
 * ThreadMarker objects. The pipeline then replaces them with actual
 * conversation messages from the inputs.
 */
model ThreadMarker {
  @doc("The input property name (e.g. 'conversation')")
  @sample(ThreadMarkerNameSample)
  name: string = "thread";

  @doc("The rich kind ('thread', 'image', 'file', 'audio')")
  @sample(ThreadMarkerKindSample)
  kind: string = "thread";
}

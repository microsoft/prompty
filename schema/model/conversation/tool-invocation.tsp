import "prompty-emitter";
import "./content.tsp";

namespace Prompty;

/**
 * A tool call requested by the LLM. Contains the function name and serialized
 * arguments that should be dispatched to the appropriate tool handler.
 */
model ToolCall {
  @doc("The unique identifier of the tool call")
  @sample(#{ id: "call_abc123" })
  id: string;

  @doc("The name of the tool to call")
  @sample(#{ name: "get_weather" })
  name: string;

  @doc("The serialized JSON arguments for the tool call")
  @sample(#{ arguments: "{\"city\": \"Paris\"}" })
  arguments: string;
}

/**
 * The result of a tool execution. Contains a list of content parts, enabling
 * rich tool results (text, images, files, audio) rather than just strings.
 *
 * Implementations MUST support conversion from a plain string to a ToolResult
 * containing a single TextPart for backward compatibility.
 */
@factory(
  "text",
  #{ parts: #[#{ kind: "text", value: "{value}" }] },
  #{ value: "string" }
)
@method("text", "string", "Concatenate all TextPart values joined by newline")
model ToolResult {
  @doc("The content parts of the tool result")
  @sample(#{ parts: #[#{ kind: "text", value: "72°F and sunny" }] })
  parts: ContentPart[];
}

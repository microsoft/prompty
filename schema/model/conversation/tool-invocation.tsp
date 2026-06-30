import "@typra/emitter";
import "./content.tsp";

namespace Prompty;

/**
 * Normalized status for tool execution. The transport can complete while the
 * tool itself fails, times out, or is cancelled; status captures the semantic
 * outcome independently of callback delivery.
 */
alias ToolResultStatus = "success" | "error" | "cancelled" | "timeout";

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

  @doc("Semantic execution status for the tool result")
  status?: ToolResultStatus;

  @doc("Stable machine-readable error category when status is not success")
  @sample(#{ errorKind: "missing_tool" })
  errorKind?: string;

  @doc("Human-readable error message when status is not success")
  @sample(#{ errorMessage: "Tool 'get_weather' is not registered" })
  errorMessage?: string;

  @doc("Tool execution duration in milliseconds")
  @sample(#{ durationMs: 42 })
  durationMs?: float64;
}

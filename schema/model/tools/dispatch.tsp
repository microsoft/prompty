import "@typra/emitter";
import "../conversation/message.tsp";
import "../conversation/tool-invocation.tsp";

namespace Prompty;

/**
 * Context passed to tool handlers during agent loop execution. Provides
 * access to the agent configuration, current conversation state, and
 * arbitrary metadata for tool implementations that need broader context.
 */
model ToolContext {
  @doc("The current conversation messages at the point of tool invocation")
  messages: Message[];

  @doc("Optional metadata for tool-specific context (e.g., user session info)")
  @sample(#{ metadata: #{ userId: "user-123" } })
  metadata?: Record<unknown>;
}

/**
 * The result of dispatching a single tool call. Pairs the tool call
 * identifier with the tool's name and result for correlation in the
 * agent loop's message assembly.
 */
model ToolDispatchResult {
  @doc("The tool call ID from the LLM response, used to correlate results")
  @sample(#{ toolCallId: "call_abc123" })
  toolCallId: string;

  @doc("The name of the tool that was called")
  @sample(#{ name: "get_weather" })
  name: string;

  @doc("The result produced by the tool handler")
  @sample(#{
    result: #{ parts: #[#{ kind: "text", value: "72°F and sunny" }] },
  })
  result: ToolResult;
}

import "prompty-emitter";
import "./message.tsp";

namespace Prompty;

/**
 * The type of event emitted during agent loop execution. Events enable
 * real-time UIs, logging, and coordination without coupling the loop
 * to any particular output mechanism.
 */
alias AgentEventType =
  | "token"
  | "thinking"
  | "tool_call_start"
  | "tool_result"
  | "status"
  | "messages_updated"
  | "done"
  | "error"
  | "cancelled"
  | "compaction_start"
  | "compaction_complete"
  | "compaction_failed";

/**
 * The kind discriminator for stream chunks.
 */
alias StreamChunkType = "text" | "thinking" | "tool" | "error";

/**
 * A chunk of data from a streaming LLM response. Stream chunks are
 * discriminated on the `kind` field.
 */
@abstract
@discriminator("kind")
model StreamChunk {
  @doc("The kind of stream chunk")
  kind: StreamChunkType;
}

/**
 * A text content chunk from the LLM response stream.
 */
model TextChunk extends StreamChunk {
  @doc("The kind identifier for text chunks")
  kind: "text";

  @doc("The text content of the chunk")
  @sample(#{ value: "Hello" })
  value: string;
}

/**
 * A thinking/reasoning content chunk from the LLM response stream.
 */
model ThinkingChunk extends StreamChunk {
  @doc("The kind identifier for thinking chunks")
  kind: "thinking";

  @doc("The thinking content of the chunk")
  @sample(#{ value: "Let me consider..." })
  value: string;
}

/**
 * A tool call chunk from the LLM response stream.
 */
model ToolChunk extends StreamChunk {
  @doc("The kind identifier for tool chunks")
  kind: "tool";

  @doc("The tool call data")
  @sample(#{
    toolCall: #{
      id: "call_abc123",
      name: "get_weather",
      arguments: "{\"city\": \"Paris\"}",
    },
  })
  toolCall: ToolCall;
}

/**
 * An error chunk from the LLM response stream.
 */
model ErrorChunk extends StreamChunk {
  @doc("The kind identifier for error chunks")
  kind: "error";

  @doc("The error message")
  @sample(#{ message: "Rate limit exceeded" })
  message: string;
}

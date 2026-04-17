import "prompty-emitter";
import "../message/message.tsp";

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

// ============================================================================
// Event payload models — typed data carried by each AgentEventType
// ============================================================================

/**
 * Payload for "token" events — a single text token streamed from the LLM.
 */
model TokenEventPayload {
  @doc("The streamed token text")
  @sample(#{ token: "Hello" })
  token: string;
}

/**
 * Payload for "thinking" events — reasoning/chain-of-thought tokens.
 */
model ThinkingEventPayload {
  @doc("The thinking/reasoning token text")
  @sample(#{ token: "Let me consider..." })
  token: string;
}

/**
 * Payload for "tool_call_start" events — the LLM has requested a tool call.
 */
model ToolCallStartPayload {
  @doc("The name of the tool being called")
  @sample(#{ name: "get_weather" })
  name: string;

  @doc("The serialized JSON arguments for the tool call")
  @sample(#{ arguments: "{\"city\": \"Paris\"}" })
  arguments: string;
}

/**
 * Payload for "tool_result" events — a tool has returned its result.
 */
model ToolResultPayload {
  @doc("The name of the tool that produced the result")
  @sample(#{ name: "get_weather" })
  name: string;

  @doc("The tool's result")
  @sample(#{
    result: #{ parts: #[#{ kind: "text", value: "72°F and sunny" }] },
  })
  result: ToolResult;
}

/**
 * Payload for "status" events — informational messages about loop progress.
 */
model StatusEventPayload {
  @doc("Human-readable status message")
  @sample(#{ message: "Starting iteration 3" })
  message: string;
}

/**
 * Payload for "messages_updated" events — the conversation state has changed.
 */
model MessagesUpdatedPayload {
  @doc("The current full message list after the update")
  messages: Message[];
}

/**
 * Payload for "done" events — the agent loop completed successfully.
 */
model DoneEventPayload {
  @doc("The final text response from the LLM")
  @sample(#{ response: "The weather in Paris is 72°F and sunny." })
  response: string;

  @doc("The final conversation state including all messages")
  messages: Message[];
}

/**
 * Payload for "error" events — an error occurred during the loop.
 */
model ErrorEventPayload {
  @doc("Human-readable error description")
  @sample(#{ message: "Rate limit exceeded" })
  message: string;
}

/**
 * Payload for "compaction_complete" events — context compaction finished.
 */
model CompactionCompletePayload {
  @doc("Number of messages removed during compaction")
  @sample(#{ removed: 5 })
  removed: int32;

  @doc("Number of messages remaining after compaction")
  @sample(#{ remaining: 3 })
  remaining: int32;
}

/**
 * Payload for "compaction_failed" events — compaction could not be completed.
 */
model CompactionFailedPayload {
  @doc("Explanation of why compaction failed")
  @sample(#{ message: "Summarization prompt exceeded context window" })
  message: string;
}

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

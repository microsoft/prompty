import "@typra/emitter";
import "../conversation/tool-invocation.tsp";
import "../model/usage.tsp";

namespace Prompty;

/**
 * The kind discriminator for stream chunks.
 */
alias StreamChunkType =
  | "text"
  | "thinking"
  | "tool"
  | "usage"
  | "error"
  | "failure";

/**
 * Whether a stream failure has a known provider outcome.
 */
alias StreamFailureOutcome = "determinate" | "indeterminate";

/**
 * A classified terminal failure from an LLM response stream.
 */
model StreamFailure {
  @doc("Whether the provider outcome is known or requires reconciliation")
  @sample(#{ outcome: "indeterminate" })
  outcome: StreamFailureOutcome;

  @doc("The human-readable failure message")
  @sample(#{ message: "SSE stream error: connection reset" })
  message: string;
}

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
 * Cumulative token usage emitted once after provider content and tool chunks.
 */
model UsageChunk extends StreamChunk {
  @doc("The kind identifier for usage chunks")
  kind: "usage";

  @doc("Complete cumulative token usage for the completed provider invocation")
  usage: InvocationUsage;
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

/**
 * A classified failure chunk from the LLM response stream.
 */
model FailureChunk extends StreamChunk {
  @doc("The kind identifier for classified failure chunks")
  @sample(#{ kind: "failure" })
  kind: "failure";

  @doc("The classified stream failure")
  @sample(#{
    failure: #{
      outcome: "indeterminate",
      message: "SSE stream error: connection reset",
    },
  })
  failure: StreamFailure;
}

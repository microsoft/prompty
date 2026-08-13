// Named sample constants for events/stream-chunks.tsp.
// Auto-extracted from inline @sample decorators.

namespace Prompty;

const TextChunkValueSample = #{ value: "Hello" };

const ThinkingChunkValueSample = #{ value: "Let me consider..." };

const ToolChunkToolCallSample = #{
  toolCall: #{
    id: "call_abc123",
    name: "get_weather",
    arguments: "{\"city\": \"Paris\"}",
  },
};

const ErrorChunkMessageSample = #{ message: "Rate limit exceeded" };

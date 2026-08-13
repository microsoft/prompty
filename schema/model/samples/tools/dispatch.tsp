// Named sample constants for tools/dispatch.tsp.
// Auto-extracted from inline @sample decorators.

namespace Prompty;

const ToolContextMetadataSample = #{ metadata: #{ userId: "user-123" } };

const ToolDispatchResultToolCallIdSample = #{ toolCallId: "call_abc123" };

const ToolDispatchResultNameSample = #{ name: "get_weather" };

const ToolDispatchResultResultSample = #{
  result: #{ parts: #[#{ kind: "text", value: "72°F and sunny" }] },
};

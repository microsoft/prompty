// Named sample constants for conversation/tool-invocation.tsp.
// Auto-extracted from inline @sample decorators.

using Prompty.Contracts.Core;
using Prompty.Contracts.Tooling;
namespace Prompty.Conformance.Samples;

const ToolCallIdSample = #{ id: "call_abc123" };

const ToolCallNameSample = #{ name: "get_weather" };

const ToolCallArgumentsSample = #{ arguments: "{\"city\": \"Paris\"}" };

const ToolResultPartsSample = #{
  parts: #[#{ kind: "text", value: "72°F and sunny" }],
};

const ToolResultErrorKindSample = #{ errorKind: "missing_tool" };

const ToolResultErrorMessageSample = #{
  errorMessage: "Tool 'get_weather' is not registered",
};

const ToolResultDurationMsSample = #{ durationMs: 42 };

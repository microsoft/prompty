// Named sample constants for conversation/message.tsp.
// Auto-extracted from inline @sample decorators.

using Prompty.Contracts.Core;
namespace Prompty.Conformance.Samples;

const MessageRoleSample = #{ role: "user" };

const MessagePartsSample = #{ parts: #[#{ kind: "text", value: "Hello!" }] };

const MessageMetadataSample = #{ metadata: #{ source: "user-input" } };

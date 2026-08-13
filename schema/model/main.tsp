// Prompty schema entry point

// Agent
import "./agent/agent.tsp";
import "./agent/guardrails.tsp";

// Conversation state
import "./conversation/message.tsp";
import "./conversation/content.tsp";
import "./conversation/tool-invocation.tsp";
import "./conversation/thread.tsp";

// Core (properties, errors, validation)
import "./core/errors.tsp";
import "./core/validation.tsp";

// Model + usage + discovery
import "./model/usage.tsp";
import "./model/discovery.tsp";
import "./model/resource-discovery.tsp";

// Samples (named sample constants referenced by @sample decorators)
import "./samples/model.tsp";
import "./samples/agent/agent.tsp";
import "./samples/agent/guardrails.tsp";
import "./samples/connection/connection.tsp";
import "./samples/connection/foundry.tsp";
import "./samples/connection/oauth.tsp";
import "./samples/connection/oauth-flow.tsp";
import "./samples/conversation/content.tsp";
import "./samples/conversation/message.tsp";
import "./samples/conversation/thread.tsp";
import "./samples/conversation/tool-invocation.tsp";
import "./samples/core/errors.tsp";
import "./samples/core/properties.tsp";
import "./samples/core/validation.tsp";
import "./samples/events/payloads.tsp";
import "./samples/events/session.tsp";
import "./samples/events/stream-chunks.tsp";
import "./samples/memory/memory.tsp";
import "./samples/model/discovery.tsp";
import "./samples/model/resource-discovery.tsp";
import "./samples/model/usage.tsp";
import "./samples/pipeline/checkpoint.tsp";
import "./samples/pipeline/context-planning.tsp";
import "./samples/pipeline/engine-events.tsp";
import "./samples/pipeline/invocation.tsp";
import "./samples/pipeline/turn-engine.tsp";
import "./samples/pipeline/turn.tsp";
import "./samples/streaming/stream.tsp";
import "./samples/template/template.tsp";
import "./samples/tools/dispatch.tsp";
import "./samples/tools/mcp.tsp";
import "./samples/tools/openapi.tsp";
import "./samples/tools/prompty.tsp";
import "./samples/tools/tool.tsp";
import "./samples/tracing/tracer.tsp";
import "./samples/wire/anthropic-types.tsp";

// Memory (agent recall + persistence data contract)
import "./memory/memory.tsp";

// Pipeline (turn options + protocol contracts)
import "./pipeline/invocation.tsp";
import "./pipeline/engine-events.tsp";
import "./pipeline/checkpoint.tsp";
import "./pipeline/turn-engine.tsp";
import "./pipeline/policy.tsp";
import "./pipeline/context-planning.tsp";
import "./pipeline/turn.tsp";
import "./pipeline/renderer.tsp";
import "./pipeline/parser.tsp";
import "./pipeline/executor.tsp";
import "./pipeline/processor.tsp";
import "./pipeline/harness.tsp";

// Behavior vectors (conformance evidence attached to callable operations)
import "./vectors/render.tsp";
import "./vectors/parse.tsp";
// process vectors are authored as a JSON-STRING set (Typra 0.7.0+ affordance)
// so they can carry populated agent.model + raw provider wire payloads (both
// contain a "model" key, which the #{} object-literal grammar forbids).
import "./vectors/process.tsp";

// Events
import "./events/payloads.tsp";
import "./events/stream-chunks.tsp";
import "./events/session.tsp";

// Streaming
import "./streaming/stream.tsp";

// Tracing
import "./tracing/tracer.tsp";

// Tools (declarations + dispatch)
import "./tools/tool.tsp";
import "./tools/mcp.tsp";
import "./tools/openapi.tsp";
import "./tools/prompty.tsp";
import "./tools/dispatch.tsp";

// Connections
import "./connection/connection.tsp";
import "./connection/oauth.tsp";
import "./connection/oauth-flow.tsp";
import "./connection/foundry.tsp";

// Wire format mappings (augment existing models with provider field names)
import "./wire/openai.tsp";
import "./wire/anthropic.tsp";
import "./wire/anthropic-types.tsp";
import "./wire/foundry.tsp";

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

// Pipeline (turn options + protocol contracts)
import "./pipeline/invocation.tsp";
import "./pipeline/turn.tsp";
import "./pipeline/renderer.tsp";
import "./pipeline/parser.tsp";
import "./pipeline/executor.tsp";
import "./pipeline/processor.tsp";
import "./pipeline/harness.tsp";

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
import "./connection/foundry.tsp";

// Wire format mappings (augment existing models with provider field names)
import "./wire/openai.tsp";
import "./wire/anthropic.tsp";
import "./wire/anthropic-types.tsp";

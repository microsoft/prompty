// Prompty schema entry point

// Agent
import "./agent.tsp";
import "./contracts/guardrails/guardrails.tsp";

// Conversation state
import "./contracts/conversation/message.tsp";
import "./contracts/conversation/content.tsp";
import "./contracts/conversation/tool-invocation.tsp";
import "./contracts/conversation/thread.tsp";

// Core (properties, errors, validation)
import "./contracts/core/errors.tsp";
import "./contracts/core/validation.tsp";

// Model + usage + discovery
import "./contracts/models/usage.tsp";
import "./contracts/models/discovery.tsp";
import "./contracts/models/resource-discovery.tsp";

// Samples (named sample constants referenced by @sample decorators)
import "./conformance/samples/model.tsp";
import "./conformance/samples/agent/agent.tsp";
import "./conformance/samples/agent/guardrails.tsp";
import "./conformance/samples/connection/connection.tsp";
import "./conformance/samples/connection/foundry.tsp";
import "./conformance/samples/connection/oauth.tsp";
import "./conformance/samples/connection/oauth-flow.tsp";
import "./conformance/samples/conversation/content.tsp";
import "./conformance/samples/conversation/message.tsp";
import "./conformance/samples/conversation/thread.tsp";
import "./conformance/samples/conversation/tool-invocation.tsp";
import "./conformance/samples/core/errors.tsp";
import "./conformance/samples/core/properties.tsp";
import "./conformance/samples/core/validation.tsp";
import "./conformance/samples/events/payloads.tsp";
import "./conformance/samples/events/session.tsp";
import "./conformance/samples/events/stream-chunks.tsp";
import "./conformance/samples/memory/memory.tsp";
import "./conformance/samples/model/discovery.tsp";
import "./conformance/samples/model/resource-discovery.tsp";
import "./conformance/samples/model/usage.tsp";
import "./conformance/samples/pipeline/checkpoint.tsp";
import "./conformance/samples/pipeline/context-planning.tsp";
import "./conformance/samples/pipeline/engine-events.tsp";
import "./conformance/samples/pipeline/invocation.tsp";
import "./conformance/samples/pipeline/turn-engine.tsp";
import "./conformance/samples/pipeline/turn.tsp";
import "./conformance/samples/streaming/stream.tsp";
import "./conformance/samples/template/template.tsp";
import "./conformance/samples/tools/dispatch.tsp";
import "./conformance/samples/tools/mcp.tsp";
import "./conformance/samples/tools/openapi.tsp";
import "./conformance/samples/tools/tool.tsp";
import "./conformance/samples/tracing/tracer.tsp";
import "./conformance/samples/wire/anthropic-types.tsp";

// Memory (agent recall + persistence data contract)
import "./contracts/memory/memory.tsp";

// Pipeline (turn options + protocol contracts)
import "./contracts/pipeline/invocation.tsp";
import "./contracts/pipeline/engine-events.tsp";
import "./contracts/pipeline/checkpoint.tsp";
import "./contracts/pipeline/turn-engine.tsp";
import "./contracts/pipeline/policy.tsp";
import "./contracts/pipeline/context-planning.tsp";
import "./contracts/pipeline/turn.tsp";
import "./operations/pipeline/renderer.tsp";
import "./operations/pipeline/parser.tsp";
import "./operations/pipeline/executor.tsp";
import "./operations/pipeline/processor.tsp";
import "./operations/pipeline/harness.tsp";
import "./operations/pipeline/engine-ports.tsp";

// Conformance-only seams hosting the remaining pipeline-stage behavior vectors.
// These carry @vector evidence into the cross-runtime vectors.json and are not
// implemented by any runtime; named/namespaced distinctly so they never collide
// with hand-written runtime contracts (e.g. Go's ReferenceTurnRunner).
import "./conformance/seams/load-conformance.tsp";
import "./conformance/seams/wire-conformance.tsp";
import "./conformance/seams/discovery-conformance.tsp";
import "./conformance/seams/turn-conformance.tsp";

// Behavior vectors (conformance evidence attached to callable operations)
import "./conformance/vectors/render.tsp";
import "./conformance/vectors/parse.tsp";
// process vectors are authored as a JSON-STRING set (Typra 0.7.0+ affordance)
// so they can carry populated agent.model + raw provider wire payloads (both
// contain a "model" key, which the #{} object-literal grammar forbids).
import "./conformance/vectors/process.tsp";
// Remaining pipeline stages, also authored as JSON-STRING vector sets and bound
// to dedicated conformance seams (LoadConformance, WireConformance,
// TurnConformance, DiscoveryConformance) under Prompty.Conformance.Seams.
import "./conformance/vectors/load.tsp";
import "./conformance/vectors/wire.tsp";
import "./conformance/vectors/agent.tsp";
import "./conformance/vectors/discovery.tsp";
import "./conformance/vectors/enrichment.tsp";
import "./conformance/vectors/turn.tsp";
import "./conformance/vectors/replay.tsp";
// Streaming-failure classification + reconciliation vectors, bound to
// Processor.processStream (a real @optionalOperation). Promoted from the standalone
// spec/vectors/process/stream_failure_vectors.json into the typra vector system so
// every runtime is held to the same streaming-failure semantics.
import "./conformance/vectors/stream.tsp";

// Events
import "./contracts/events/payloads.tsp";
import "./contracts/events/stream-chunks.tsp";
import "./contracts/events/session.tsp";

// Streaming
import "./contracts/streaming/stream.tsp";

// Tracing
import "./contracts/tracing/tracer.tsp";

// Tools (declarations + dispatch)
import "./contracts/tooling/tool.tsp";
import "./contracts/tooling/mcp.tsp";
import "./contracts/tooling/openapi.tsp";
import "./contracts/tooling/dispatch.tsp";

// Connections
import "./contracts/connectivity/connection.tsp";
import "./contracts/connectivity/oauth.tsp";
import "./contracts/connectivity/oauth-flow.tsp";
import "./contracts/connectivity/foundry.tsp";

// Wire format mappings (augment existing models with provider field names)
import "./wire/openai.tsp";
import "./wire/anthropic.tsp";
import "./wire/anthropic/anthropic-types.tsp";
import "./wire/foundry.tsp";

// Named sample constants for tracing/tracer.tsp.
// Auto-extracted from inline @sample decorators.

using Prompty.Contracts.Connectivity;
using Prompty.Contracts.Core;
namespace Prompty.Conformance.Samples;

const TraceTimeStartSample = #{ start: "2026-04-04T12:00:00Z" };

const TraceTimeEndSample = #{ end: "2026-04-04T12:00:01Z" };

const TraceTimeDurationSample = #{ duration: 1000 };

const TraceSpanNameSample = #{ name: "prompty.core.pipeline.run" };

const TraceSpanSignatureSample = #{ signature: "prompty.core.pipeline.run" };

const TraceSpanErrorSample = #{ error: "Connection refused" };

const TraceFileRuntimeSample = #{ runtime: "python" };

const TraceFileVersionSample = #{ version: "2.0.0" };

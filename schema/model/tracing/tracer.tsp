import "@typra/emitter";
import "../model/usage.tsp";

using Prompty.Conformance.Samples;
using Prompty.Contracts.Models;
namespace Prompty.Contracts.Tracing;

/**
 * A recursive union of JSON-safe primitive types used for trace values.
 * All values emitted to tracing backends are serialized to TraceValue
 * via the `to_dict` algorithm (§3.3).
 *
 * Note: The recursive nature (arrays and records of TraceValue) is
 * expressed as `unknown` to avoid infinite recursion in code generators.
 * Implementations should treat array/record variants as containing
 * nested TraceValue instances.
 */
union TraceValue {
  @doc("A string trace value")
  string: string,

  @doc("An integer trace value")
  integer: int32,

  @doc("A floating-point trace value")
  float: float64,

  @doc("A boolean trace value")
  boolean: boolean,

  @doc("A null trace value")
  null: null,

  @doc("An array of trace values (recursive)")
  array: unknown[],

  @doc("A record/map of trace values (recursive)")
  record: Record<unknown>,
}

/**
 * Timing information for a trace span.
 */
model TraceTime {
  @doc("ISO 8601 UTC timestamp when the span started")
  @sample(TraceTimeStartSample)
  start: string;

  @doc("ISO 8601 UTC timestamp when the span ended")
  @sample(TraceTimeEndSample)
  end: string;

  @doc("Duration of the span in milliseconds")
  @sample(TraceTimeDurationSample)
  duration: float64;
}

/**
 * A single trace span capturing one pipeline stage or function invocation.
 * Spans nest via the `__frames` field to form a tree representing the
 * full execution (§3.6.1).
 */
model TraceSpan {
  @doc("The name of this span (typically the function signature)")
  @sample(TraceSpanNameSample)
  name: string;

  @doc("Timing information for this span")
  __time: TraceTime;

  @doc("Fully-qualified function signature that produced this span")
  @sample(TraceSpanSignatureSample)
  signature?: string;

  @doc("Serialized input parameters (redacted per §3.4)")
  inputs?: Record<unknown>;

  @doc("Serialized return value or error information (redacted per §3.4)")
  output?: unknown;

  @doc("Error message if the span ended with an exception")
  @sample(TraceSpanErrorSample)
  error?: string;

  @doc("Aggregated token usage hoisted from child spans (§3.5)")
  __usage?: TokenUsage;

  @doc("Additional span attributes (e.g., OpenTelemetry GenAI attributes)")
  attributes?: Record<unknown>;

  @doc("Nested child spans forming the execution tree (recursive; each element is a TraceSpan)")
  __frames?: unknown[];
}

/**
 * The top-level .tracy file structure written by the file backend (§3.6.1).
 */
model TraceFile {
  @doc("Language/runtime name (e.g., 'python', 'csharp', 'javascript')")
  @sample(TraceFileRuntimeSample)
  runtime: string;

  @doc("Prompty library version")
  @sample(TraceFileVersionSample)
  version: string;

  @doc("The root trace span")
  trace: TraceSpan;
}

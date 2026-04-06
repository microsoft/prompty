import { describe, it, expect, beforeEach, vi } from "vitest";
import { otelTracer, type OtelApi } from "../src/tracing/otel.js";
import { Tracer } from "../src/tracing/tracer.js";

// ---------------------------------------------------------------------------
// Mock OTel API
// ---------------------------------------------------------------------------

function createMockSpan() {
  return {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  };
}

function createMockApi(span = createMockSpan()): { api: OtelApi; span: ReturnType<typeof createMockSpan> } {
  const api: OtelApi = {
    trace: {
      getTracer: vi.fn().mockReturnValue({
        startSpan: vi.fn().mockReturnValue(span),
      }),
      setSpan: vi.fn().mockReturnValue({}),
    },
    context: {
      active: vi.fn().mockReturnValue({}),
      with: vi.fn().mockImplementation((_ctx, fn) => fn()),
    },
    SpanStatusCode: {
      OK: 0,
      ERROR: 1,
    },
  };
  return { api, span };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("otelTracer", () => {
  beforeEach(() => {
    Tracer.clear();
  });

  it("creates a tracer with the default name", () => {
    const { api } = createMockApi();
    otelTracer(api);
    expect(api.trace.getTracer).toHaveBeenCalledWith("prompty");
  });

  it("creates a tracer with a custom name", () => {
    const { api } = createMockApi();
    otelTracer(api, { tracerName: "my-service" });
    expect(api.trace.getTracer).toHaveBeenCalledWith("my-service");
  });

  it("starts a span when the factory is called", () => {
    const { api, span } = createMockApi();
    const factory = otelTracer(api);
    const backend = factory("test-span");
    expect(backend).not.toBeNull();
    const tracer = (api.trace.getTracer as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(tracer.startSpan).toHaveBeenCalledWith("test-span");
  });

  it("sets primitive attributes on the span", () => {
    const { api, span } = createMockApi();
    const factory = otelTracer(api);
    const backend = factory("test-span")!;

    backend("model", "gpt-4");
    backend("temperature", 0.7);
    backend("stream", true);

    expect(span.setAttribute).toHaveBeenCalledWith("model", "gpt-4");
    expect(span.setAttribute).toHaveBeenCalledWith("temperature", 0.7);
    expect(span.setAttribute).toHaveBeenCalledWith("stream", true);
  });

  it("flattens nested objects into dotted attributes", () => {
    const { api, span } = createMockApi();
    const factory = otelTracer(api);
    const backend = factory("test-span")!;

    backend("model", { id: "gpt-4", options: { temperature: 0.5 } });

    expect(span.setAttribute).toHaveBeenCalledWith("model.id", "gpt-4");
    expect(span.setAttribute).toHaveBeenCalledWith("model.options.temperature", 0.5);
  });

  it("serializes arrays as JSON strings", () => {
    const { api, span } = createMockApi();
    const factory = otelTracer(api);
    const backend = factory("test-span")!;

    backend("messages", [{ role: "user", content: "hello" }]);

    expect(span.setAttribute).toHaveBeenCalledWith(
      "messages",
      JSON.stringify([{ role: "user", content: "hello" }]),
    );
  });

  it("ends the span on __end__", () => {
    const { api, span } = createMockApi();
    const factory = otelTracer(api);
    const backend = factory("test-span")!;

    backend("__end__", undefined);

    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it("does not set attributes on __end__", () => {
    const { api, span } = createMockApi();
    const factory = otelTracer(api);
    const backend = factory("test-span")!;

    backend("__end__", undefined);

    expect(span.setAttribute).not.toHaveBeenCalled();
  });

  it("handles Error values on the error key", () => {
    const { api, span } = createMockApi();
    const factory = otelTracer(api);
    const backend = factory("test-span")!;

    const err = new Error("something broke");
    backend("error", err);

    expect(span.setStatus).toHaveBeenCalledWith({
      code: api.SpanStatusCode.ERROR,
      message: "Error: something broke",
    });
    expect(span.recordException).toHaveBeenCalledWith(err);
    expect(span.setAttribute).toHaveBeenCalledWith("exception.stacktrace", expect.any(String));
  });

  it("handles string values on the error key", () => {
    const { api, span } = createMockApi();
    const factory = otelTracer(api);
    const backend = factory("test-span")!;

    backend("error", "timeout");

    expect(span.setStatus).toHaveBeenCalledWith({
      code: api.SpanStatusCode.ERROR,
      message: "timeout",
    });
    expect(span.recordException).not.toHaveBeenCalled();
    expect(span.setAttribute).toHaveBeenCalledWith("exception.message", "timeout");
  });

  it("ignores null/undefined values", () => {
    const { api, span } = createMockApi();
    const factory = otelTracer(api);
    const backend = factory("test-span")!;

    backend("empty", null);
    backend("undef", undefined);

    expect(span.setAttribute).not.toHaveBeenCalled();
  });

  it("integrates with Tracer.add and Tracer.start", () => {
    const { api, span } = createMockApi();
    Tracer.add("otel", otelTracer(api));

    const s = Tracer.start("pipeline-step");
    s("model", "gpt-4");
    s.end();

    expect(span.setAttribute).toHaveBeenCalledWith("model", "gpt-4");
    expect(span.end).toHaveBeenCalled();
  });
});

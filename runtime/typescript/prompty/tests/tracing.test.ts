import { describe, it, expect, beforeEach, vi } from "vitest";
import { Tracer, trace, traceSpan, sanitizeValue, toSerializable } from "../src/tracing/tracer.js";
import { consoleTracer } from "../src/tracing/console.js";

describe("Tracer", () => {
  beforeEach(() => {
    Tracer.clear();
  });

  it("emits events to registered backends", () => {
    const events: [string, unknown][] = [];
    Tracer.add("test", (_sig) => (key, value) => {
      events.push([key, value]);
    });

    const span = Tracer.start("test-span");
    span("key1", "value1");
    span("key2", 42);
    span.end();

    expect(events).toContainEqual(["key1", "value1"]);
    expect(events).toContainEqual(["key2", 42]);
  });

  it("supports multiple backends", () => {
    let count1 = 0;
    let count2 = 0;
    Tracer.add("a", () => () => { count1++; });
    Tracer.add("b", () => () => { count2++; });

    const span = Tracer.start("multi");
    span("event", "data");
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  it("remove() removes a backend", () => {
    let called = false;
    Tracer.add("test", () => () => { called = true; });
    Tracer.remove("test");

    const span = Tracer.start("after-remove");
    span("event", "data");
    expect(called).toBe(false);
  });
});

describe("trace()", () => {
  beforeEach(() => {
    Tracer.clear();
  });

  it("wraps an async function with tracing", async () => {
    const events: [string, unknown][] = [];
    Tracer.add("test", (_sig) => (key, value) => {
      events.push([key, value]);
    });

    const fn = trace(async (x: number) => x * 2, "double");
    const result = await fn(5);

    expect(result).toBe(10);
    expect(events.some(([k]) => k === "result")).toBe(true);
    expect(events.some(([k]) => k === "duration_ms")).toBe(true);
  });

  it("traces errors", async () => {
    const events: [string, unknown][] = [];
    Tracer.add("test", () => (key, value) => {
      events.push([key, value]);
    });

    const fn = trace(async () => { throw new Error("boom"); }, "failing");
    await expect(fn()).rejects.toThrow("boom");
    expect(events.some(([k]) => k === "error")).toBe(true);
  });
});

describe("traceSpan()", () => {
  beforeEach(() => {
    Tracer.clear();
  });

  it("executes callback within a span", async () => {
    const events: [string, unknown][] = [];
    Tracer.add("test", () => (key, value) => {
      events.push([key, value]);
    });

    const result = await traceSpan("myspan", async (emit) => {
      emit("step", "processing");
      return 42;
    });

    expect(result).toBe(42);
    expect(events).toContainEqual(["step", "processing"]);
  });
});

describe("sanitizeValue()", () => {
  it("redacts sensitive keys", () => {
    expect(sanitizeValue("apiKey", "sk-secret")).toBe("***REDACTED***");
    expect(sanitizeValue("password", "p@ss")).toBe("***REDACTED***");
    expect(sanitizeValue("api_token", "tok")).toBe("***REDACTED***");
  });

  it("passes through non-sensitive keys", () => {
    expect(sanitizeValue("name", "Alice")).toBe("Alice");
    expect(sanitizeValue("count", 42)).toBe(42);
  });

  it("recursively sanitizes objects", () => {
    const result = sanitizeValue("config", { apiKey: "secret", name: "test" });
    expect(result).toEqual({ apiKey: "***REDACTED***", name: "test" });
  });
});

describe("toSerializable()", () => {
  it("handles primitives", () => {
    expect(toSerializable(42)).toBe(42);
    expect(toSerializable("hello")).toBe("hello");
    expect(toSerializable(true)).toBe(true);
    expect(toSerializable(null)).toBe(null);
  });

  it("handles Date", () => {
    const d = new Date("2024-01-01T00:00:00Z");
    expect(toSerializable(d)).toBe("2024-01-01T00:00:00.000Z");
  });

  it("handles Error", () => {
    const err = new Error("test");
    const result = toSerializable(err) as Record<string, unknown>;
    expect(result.name).toBe("Error");
    expect(result.message).toBe("test");
  });

  it("handles Map and Set", () => {
    expect(toSerializable(new Map([["a", 1]]))).toEqual({ a: 1 });
    expect(toSerializable(new Set([1, 2, 3]))).toEqual([1, 2, 3]);
  });
});

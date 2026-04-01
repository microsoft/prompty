import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Tracer, trace, traceMethod, traceSpan, sanitizeValue, toSerializable } from "../src/tracing/tracer.js";
import { consoleTracer } from "../src/tracing/console.js";
import { PromptyTracer } from "../src/tracing/promptyTracer.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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

describe("traceMethod() decorator", () => {
  beforeEach(() => {
    Tracer.clear();
  });

  it("traces a decorated method", async () => {
    const events: [string, unknown][] = [];
    Tracer.add("test", () => (key, value) => {
      events.push([key, value]);
    });

    class MyService {
      @traceMethod()
      async greet(name: string): Promise<string> {
        return `Hello, ${name}!`;
      }
    }

    const svc = new MyService();
    const result = await svc.greet("World");

    expect(result).toBe("Hello, World!");
    expect(events.some(([k]) => k === "result")).toBe(true);
    expect(events.some(([k]) => k === "duration_ms")).toBe(true);
  });

  it("traces errors from decorated methods", async () => {
    const events: [string, unknown][] = [];
    Tracer.add("test", () => (key, value) => {
      events.push([key, value]);
    });

    class Failing {
      @traceMethod()
      async boom(): Promise<void> {
        throw new Error("kaboom");
      }
    }

    await expect(new Failing().boom()).rejects.toThrow("kaboom");
    expect(events.some(([k]) => k === "error")).toBe(true);
  });

  it("emits custom attributes", async () => {
    const events: [string, unknown][] = [];
    Tracer.add("test", () => (key, value) => {
      events.push([key, value]);
    });

    class Svc {
      @traceMethod({ version: "2.0" })
      async op(): Promise<number> {
        return 1;
      }
    }

    await new Svc().op();
    expect(events).toContainEqual(["version", "2.0"]);
  });
});

describe("sanitizeValue()", () => {
  it("redacts sensitive keys", () => {
    expect(sanitizeValue("apiKey", "sk-secret")).toBe("***REDACTED***");
    expect(sanitizeValue("api_key", "sk-secret")).toBe("***REDACTED***");
    expect(sanitizeValue("password", "p@ss")).toBe("***REDACTED***");
    expect(sanitizeValue("api_token", "tok")).toBe("***REDACTED***");
    expect(sanitizeValue("secret", "shhh")).toBe("***REDACTED***");
    expect(sanitizeValue("my_secret", "hunter2")).toBe("***REDACTED***");
    expect(sanitizeValue("credential", "cred")).toBe("***REDACTED***");
    expect(sanitizeValue("passphrase", "shhh")).toBe("***REDACTED***");
    expect(sanitizeValue("bearer", "xyz")).toBe("***REDACTED***");
    expect(sanitizeValue("authorization", "Bearer xyz")).toBe("***REDACTED***");
    expect(sanitizeValue("client_secret", "cs")).toBe("***REDACTED***");
  });

  it("does not redact non-sensitive keys that contain similar substrings", () => {
    // "token" should not match plural "tokens" (usage metrics)
    expect(sanitizeValue("prompt_tokens", 100)).toBe(100);
    expect(sanitizeValue("completion_tokens", 50)).toBe(50);
    expect(sanitizeValue("total_tokens", 150)).toBe(150);
    expect(sanitizeValue("maxOutputTokens", 1000)).toBe(1000);
    // "auth" should not match "author"/"authors"
    expect(sanitizeValue("authors", "Alice")).toBe("Alice");
    expect(sanitizeValue("author", "Bob")).toBe("Bob");
    // generic "key" should not match
    expect(sanitizeValue("primary_key", "pk-123")).toBe("pk-123");
    expect(sanitizeValue("sort_key", "sk-123")).toBe("sk-123");
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

describe("PromptyTracer", () => {
  let tempDir: string;

  beforeEach(() => {
    Tracer.clear();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompty-tracer-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes a .tracy file on root span completion", async () => {
    const pt = new PromptyTracer({ outputDir: tempDir, version: "2.0.0-test" });
    Tracer.add("test", pt.factory);

    await traceSpan("mytest", async (emit) => {
      emit("inputs", { question: "hello" });
      emit("result", "world");
    });

    const files = fs.readdirSync(tempDir).filter(f => f.endsWith(".tracy"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^mytest\.\d{8}\.\d{6}\.tracy$/);

    const content = JSON.parse(fs.readFileSync(path.join(tempDir, files[0]), "utf-8"));
    expect(content.runtime).toBe("typescript");
    expect(content.version).toBe("2.0.0-test");
    expect(content.trace.name).toBe("mytest");
    expect(content.trace.inputs).toEqual({ question: "hello" });
    expect(content.trace.result).toBe("world");
  });

  it("captures __time with start, end, and duration", async () => {
    const pt = new PromptyTracer({ outputDir: tempDir });
    Tracer.add("test", pt.factory);

    await traceSpan("timed", async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const files = fs.readdirSync(tempDir).filter(f => f.endsWith(".tracy"));
    const content = JSON.parse(fs.readFileSync(path.join(tempDir, files[0]), "utf-8"));
    const time = content.trace.__time;

    expect(time.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+$/);
    expect(time.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+$/);
    expect(time.duration).toBeGreaterThanOrEqual(40);
  });

  it("nests child spans into __frames", async () => {
    const pt = new PromptyTracer({ outputDir: tempDir });
    Tracer.add("test", pt.factory);

    await traceSpan("parent", async (emit) => {
      emit("description", "Parent span");

      await traceSpan("child1", async (childEmit) => {
        childEmit("step", "first");
      });

      await traceSpan("child2", async (childEmit) => {
        childEmit("step", "second");
      });
    });

    const files = fs.readdirSync(tempDir).filter(f => f.endsWith(".tracy"));
    expect(files).toHaveLength(1);

    const content = JSON.parse(fs.readFileSync(path.join(tempDir, files[0]), "utf-8"));
    const trace = content.trace;

    expect(trace.name).toBe("parent");
    expect(trace.description).toBe("Parent span");
    expect(trace.__frames).toHaveLength(2);
    expect(trace.__frames[0].name).toBe("child1");
    expect(trace.__frames[0].step).toBe("first");
    expect(trace.__frames[1].name).toBe("child2");
    expect(trace.__frames[1].step).toBe("second");
  });

  it("nests deeply (3 levels)", async () => {
    const pt = new PromptyTracer({ outputDir: tempDir });
    Tracer.add("test", pt.factory);

    await traceSpan("root", async () => {
      await traceSpan("mid", async () => {
        await traceSpan("leaf", async (emit) => {
          emit("data", "deep");
        });
      });
    });

    const files = fs.readdirSync(tempDir).filter(f => f.endsWith(".tracy"));
    const content = JSON.parse(fs.readFileSync(path.join(tempDir, files[0]), "utf-8"));

    expect(content.trace.__frames[0].name).toBe("mid");
    expect(content.trace.__frames[0].__frames[0].name).toBe("leaf");
    expect(content.trace.__frames[0].__frames[0].data).toBe("deep");
  });

  it("hoists __usage from result", async () => {
    const pt = new PromptyTracer({ outputDir: tempDir });
    Tracer.add("test", pt.factory);

    await traceSpan("withusage", async (emit) => {
      emit("result", {
        content: "hello",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });
    });

    const files = fs.readdirSync(tempDir).filter(f => f.endsWith(".tracy"));
    const content = JSON.parse(fs.readFileSync(path.join(tempDir, files[0]), "utf-8"));

    expect(content.trace.__usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });
  });

  it("aggregates __usage from child frames", async () => {
    const pt = new PromptyTracer({ outputDir: tempDir });
    Tracer.add("test", pt.factory);

    await traceSpan("parent", async () => {
      await traceSpan("call1", async (emit) => {
        emit("result", { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      });
      await traceSpan("call2", async (emit) => {
        emit("result", { usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
      });
    });

    const files = fs.readdirSync(tempDir).filter(f => f.endsWith(".tracy"));
    const content = JSON.parse(fs.readFileSync(path.join(tempDir, files[0]), "utf-8"));

    expect(content.trace.__usage).toEqual({
      prompt_tokens: 30,
      completion_tokens: 15,
      total_tokens: 45,
    });
  });

  it("sets lastTracePath after writing", async () => {
    const pt = new PromptyTracer({ outputDir: tempDir });
    Tracer.add("test", pt.factory);

    expect(pt.lastTracePath).toBeUndefined();

    await traceSpan("test", async () => {});

    expect(pt.lastTracePath).toBeDefined();
    expect(pt.lastTracePath!.endsWith(".tracy")).toBe(true);
    expect(fs.existsSync(pt.lastTracePath!)).toBe(true);
  });

  it("creates output directory if missing", () => {
    const newDir = path.join(tempDir, "subdir", "runs");
    expect(fs.existsSync(newDir)).toBe(false);

    new PromptyTracer({ outputDir: newDir });
    expect(fs.existsSync(newDir)).toBe(true);
  });

  it("produces .tracy format matching Python PromptyTracer structure", async () => {
    const pt = new PromptyTracer({ outputDir: tempDir, version: "2.0.0" });
    Tracer.add("test", pt.factory);

    await traceSpan("completion", async (emit) => {
      emit("type", "vscode");
      emit("signature", "prompty.vscode.execute");
      emit("description", "Prompty VS Code Execution");
      emit("inputs", { prompt_path: "test.prompty" });

      await traceSpan("load", async (loadEmit) => {
        loadEmit("signature", "prompty.load");
        loadEmit("description", "Load a prompty file.");
        loadEmit("inputs", { prompty_file: "test.prompty" });
        loadEmit("result", { name: "test", model: { id: "gpt-4", api: "chat" } });
      });

      await traceSpan("execute", async (execEmit) => {
        execEmit("signature", "prompty.execute");
        execEmit("description", "Execute a prompty");

        await traceSpan("prepare", async (prepEmit) => {
          prepEmit("signature", "prompty.prepare");

          await traceSpan("render", async (renderEmit) => {
            renderEmit("format", "nunjucks");
            renderEmit("rendered_length", 100);
          });

          await traceSpan("parse", async (parseEmit) => {
            parseEmit("parser", "prompty");
            parseEmit("message_count", 2);
          });
        });

        await traceSpan("run", async (runEmit) => {
          runEmit("provider", "openai");
          runEmit("result", { content: "Hello!", usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });
        });
      });

      emit("result", "Hello!");
    });

    const files = fs.readdirSync(tempDir).filter(f => f.endsWith(".tracy"));
    expect(files).toHaveLength(1);

    const content = JSON.parse(fs.readFileSync(path.join(tempDir, files[0]), "utf-8"));

    // Top-level structure matches Python
    expect(content.runtime).toBe("typescript");
    expect(content.version).toBe("2.0.0");
    expect(content.trace.name).toBe("completion");
    expect(content.trace.type).toBe("vscode");
    expect(content.trace.signature).toBe("prompty.vscode.execute");
    expect(content.trace.description).toBe("Prompty VS Code Execution");
    expect(content.trace.__time).toBeDefined();
    expect(content.trace.__time.start).toBeTruthy();
    expect(content.trace.__time.end).toBeTruthy();
    expect(content.trace.__time.duration).toBeGreaterThanOrEqual(0);

    // Nested frame structure: load + execute
    expect(content.trace.__frames).toHaveLength(2);
    expect(content.trace.__frames[0].name).toBe("load");
    expect(content.trace.__frames[0].signature).toBe("prompty.load");
    expect(content.trace.__frames[1].name).toBe("execute");

    // execute has prepare + run
    const execFrame = content.trace.__frames[1];
    expect(execFrame.__frames).toHaveLength(2);
    expect(execFrame.__frames[0].name).toBe("prepare");
    expect(execFrame.__frames[1].name).toBe("run");

    // prepare has render + parse
    const prepFrame = execFrame.__frames[0];
    expect(prepFrame.__frames).toHaveLength(2);
    expect(prepFrame.__frames[0].name).toBe("render");
    expect(prepFrame.__frames[1].name).toBe("parse");

    // Usage hoisted up from run frame
    expect(content.trace.__usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 3,
      total_tokens: 8,
    });
  });
});

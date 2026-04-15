import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resilientJsonParse,
  extractFirstJsonBlock,
} from "../src/core/tool-dispatch.js";
import {
  turn,
  ExecuteError,
} from "../src/core/pipeline.js";
import {
  registerRenderer,
  registerParser,
  registerExecutor,
  registerProcessor,
} from "../src/core/registry.js";
import { Message, text, messageText } from "../src/core/types.js";
import { ToolResult } from "../src/model/tool-result.js";
import { toolResultText } from "../src/core/types.js";
import { Prompty } from "@prompty/core";
import type { Renderer, Parser, Executor, Processor } from "../src/core/interfaces.js";

// ---------------------------------------------------------------------------
// Resilient JSON Parsing (§9.8)
// ---------------------------------------------------------------------------

describe("Resilient JSON Parsing (§9.8)", () => {
  it("parses valid JSON directly", () => {
    expect(resilientJsonParse('{"city": "NY"}')).toEqual({ city: "NY" });
  });

  it("parses JSON array and returns object", () => {
    const result = resilientJsonParse("[1, 2, 3]");
    expect(result).toEqual([1, 2, 3]);
  });

  it("wraps primitives in _raw", () => {
    expect(resilientJsonParse("42")).toEqual({ _raw: 42 });
    expect(resilientJsonParse('"hello"')).toEqual({ _raw: "hello" });
  });

  it("strips markdown fences", () => {
    const raw = '```json\n{"city": "NY"}\n```';
    expect(resilientJsonParse(raw)).toEqual({ city: "NY" });
  });

  it("strips markdown fences without json hint", () => {
    const raw = '```\n{"temp": 72}\n```';
    expect(resilientJsonParse(raw)).toEqual({ temp: 72 });
  });

  it("extracts JSON block from prose", () => {
    const raw = 'Here is the result: {"city": "NY"} enjoy!';
    expect(resilientJsonParse(raw)).toEqual({ city: "NY" });
  });

  it("strips trailing commas", () => {
    const raw = '{"city": "NY", "temp": 72,}';
    const result = resilientJsonParse(raw);
    expect(result).toEqual({ city: "NY", temp: 72 });
  });

  it("strips trailing comma in array", () => {
    const raw = '{"items": [1, 2, 3,]}';
    const result = resilientJsonParse(raw);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it("returns null when all strategies fail", () => {
    expect(resilientJsonParse("not json at all")).toBeNull();
  });

  it("does NOT silently substitute empty object", () => {
    expect(resilientJsonParse("garbage")).toBeNull();
  });

  it("handles empty string", () => {
    expect(resilientJsonParse("")).toBeNull();
  });

  it("handles nested valid JSON", () => {
    const raw = '{"a": {"b": {"c": 1}}}';
    expect(resilientJsonParse(raw)).toEqual({ a: { b: { c: 1 } } });
  });
});

// ---------------------------------------------------------------------------
// extractFirstJsonBlock
// ---------------------------------------------------------------------------

describe("extractFirstJsonBlock", () => {
  it("respects string escapes", () => {
    const raw = 'prefix {"key": "value with {braces}"} suffix';
    const block = extractFirstJsonBlock(raw);
    expect(JSON.parse(block!)).toEqual({ key: "value with {braces}" });
  });

  it("returns null with no JSON", () => {
    expect(extractFirstJsonBlock("no json here")).toBeNull();
  });

  it("handles nested objects", () => {
    const raw = 'text {"a": {"b": 1}} more';
    const block = extractFirstJsonBlock(raw);
    expect(JSON.parse(block!)).toEqual({ a: { b: 1 } });
  });

  it("handles escaped quotes in strings", () => {
    const raw = 'x {"key": "val\\"ue"} y';
    const block = extractFirstJsonBlock(raw);
    expect(JSON.parse(block!)).toEqual({ key: 'val"ue' });
  });

  it("returns null for unbalanced braces", () => {
    expect(extractFirstJsonBlock("text { no close")).toBeNull();
  });

  it("extracts first block when multiple exist", () => {
    const raw = '{"a": 1} and {"b": 2}';
    const block = extractFirstJsonBlock(raw);
    expect(JSON.parse(block!)).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// LLM Call Retry (§9.10)
// ---------------------------------------------------------------------------

class MockRenderer implements Renderer {
  async render(_agent: Prompty, template: string, inputs: Record<string, unknown>): Promise<string> {
    let result = template;
    for (const [key, val] of Object.entries(inputs)) {
      result = result.replace(`{{${key}}}`, String(val));
    }
    return result;
  }
}

class MockParser implements Parser {
  async parse(_agent: Prompty, rendered: string): Promise<Message[]> {
    return [new Message({ role: "user", parts: [text(rendered)] })];
  }
}

class MockProcessor implements Processor {
  async process(_agent: Prompty, response: unknown): Promise<unknown> {
    const r = response as Record<string, unknown>;
    const choices = r.choices as Record<string, unknown>[];
    const msg = choices[0].message as Record<string, unknown>;
    return msg.content;
  }
}

function makeAgent(): Prompty {
  const agent = new Prompty({
    name: "test",
    model: "gpt-4o",
    instructions: "Hello, {{name}}!",
  });
  agent.template = { format: { kind: "mock" }, parser: { kind: "mock" } } as any;
  (agent as any).model = { provider: "retrymock" };
  return agent;
}

describe("LLM Call Retry (§9.10)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registerRenderer("mock", new MockRenderer());
    registerParser("mock", new MockParser());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on transient failure and succeeds", async () => {
    let callCount = 0;
    const retryExecutor: Executor = {
      async execute(_agent: Prompty, _messages: Message[]): Promise<unknown> {
        callCount++;
        if (callCount === 1) {
          throw new Error("Transient network error");
        }
        // Second call: return tool calls first time
        if (callCount === 2) {
          return {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_1",
                  type: "function",
                  function: { name: "greet", arguments: '{"who":"World"}' },
                }],
              },
            }],
          };
        }
        // Third call: return final response
        return {
          choices: [{ message: { role: "assistant", content: "Retry success!" } }],
        };
      },
      formatToolMessages(
        _rawResponse: unknown,
        toolCalls: { id: string; name: string; arguments: string }[],
        toolResults: ToolResult[],
        textContent = "",
      ): Message[] {
        const messages: Message[] = [];
        const rawToolCalls = toolCalls.map((tc) => ({
          id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments },
        }));
        messages.push(new Message({ role: "assistant", parts: textContent ? [text(textContent)] : [], metadata: { tool_calls: rawToolCalls } }));
        for (let i = 0; i < toolCalls.length; i++) {
          messages.push(new Message({ role: "tool", parts: [text(toolResultText(toolResults[i]))], metadata: { tool_call_id: toolCalls[i].id, name: toolCalls[i].name } }));
        }
        return messages;
      },
    };

    registerExecutor("retrymock", retryExecutor);
    registerProcessor("retrymock", new MockProcessor());

    const agent = makeAgent();
    const tools = { greet: (args: Record<string, unknown>) => `Hello ${args.who}!` };

    const promise = turn(agent, { name: "Test" }, { tools: tools as any, maxLlmRetries: 3 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("Retry success!");
    expect(callCount).toBe(3); // 1 fail + 1 tool call + 1 final
  });

  it("throws ExecuteError with messages on exhaustion", async () => {
    const alwaysFailExecutor: Executor = {
      async execute(): Promise<unknown> {
        throw new Error("Service unavailable");
      },
      formatToolMessages(
        _rawResponse: unknown,
        toolCalls: { id: string; name: string; arguments: string }[],
        toolResults: ToolResult[],
        textContent = "",
      ): Message[] {
        return [];
      },
    };

    registerExecutor("retrymock", alwaysFailExecutor);
    registerProcessor("retrymock", new MockProcessor());

    const agent = makeAgent();
    const tools = { greet: () => "hello" };

    const promise = turn(agent, { name: "Test" }, { tools: tools as any, maxLlmRetries: 2 });
    // Attach catch handler immediately to prevent unhandled rejection during timer flush
    const settled = promise.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await settled;
    expect(err).toBeInstanceOf(ExecuteError);
    const execErr = err as ExecuteError;
    expect(execErr.message).toContain("2 retries");
    expect(execErr.message).toContain("Service unavailable");
    expect(execErr.messages).toBeInstanceOf(Array);
    expect(execErr.messages.length).toBeGreaterThan(0);
  });

  it("emits status event before retry", async () => {
    let callCount = 0;
    const flakeyExecutor: Executor = {
      async execute(_agent: Prompty, _messages: Message[]): Promise<unknown> {
        callCount++;
        if (callCount === 1) throw new Error("Temporary failure");
        // Return tool call then final
        if (callCount === 2) {
          return {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_1",
                  type: "function",
                  function: { name: "greet", arguments: '{}' },
                }],
              },
            }],
          };
        }
        return { choices: [{ message: { role: "assistant", content: "Done" } }] };
      },
      formatToolMessages(
        _rawResponse: unknown,
        toolCalls: { id: string; name: string; arguments: string }[],
        toolResults: ToolResult[],
        textContent = "",
      ): Message[] {
        const messages: Message[] = [];
        const rawToolCalls = toolCalls.map((tc) => ({
          id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments },
        }));
        messages.push(new Message({ role: "assistant", parts: textContent ? [text(textContent)] : [], metadata: { tool_calls: rawToolCalls } }));
        for (let i = 0; i < toolCalls.length; i++) {
          messages.push(new Message({ role: "tool", parts: [text(toolResultText(toolResults[i]))], metadata: { tool_call_id: toolCalls[i].id, name: toolCalls[i].name } }));
        }
        return messages;
      },
    };

    registerExecutor("retrymock", flakeyExecutor);
    registerProcessor("retrymock", new MockProcessor());

    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const onEvent = (type: string, data: Record<string, unknown>) => {
      events.push({ type, data });
    };

    const agent = makeAgent();
    const tools = { greet: () => "hi" };

    const promise = turn(agent, { name: "Test" }, {
      tools: tools as any,
      maxLlmRetries: 3,
      onEvent: onEvent as any,
    });
    await vi.runAllTimersAsync();
    await promise;

    const statusEvents = events.filter(e => e.type === "status");
    const retryEvent = statusEvents.find(e =>
      typeof e.data.message === "string" && e.data.message.includes("retrying"),
    );
    expect(retryEvent).toBeDefined();
    expect(retryEvent!.data.message).toContain("attempt 2/3");
  });

  it("does not retry in simple mode (no tools)", async () => {
    let callCount = 0;
    const failOnceExecutor: Executor = {
      async execute(): Promise<unknown> {
        callCount++;
        throw new Error("API error");
      },
      formatToolMessages() { return []; },
    };

    registerExecutor("retrymock", failOnceExecutor);
    registerProcessor("retrymock", new MockProcessor());

    const agent = makeAgent();

    // No tools = simple mode, should NOT retry
    await expect(
      turn(agent, { name: "Test" }),
    ).rejects.toThrow("API error");
    expect(callCount).toBe(1); // Only called once, no retry
  });

  it("respects maxLlmRetries: 1 (no retries)", async () => {
    let callCount = 0;
    const alwaysFail: Executor = {
      async execute(): Promise<unknown> {
        callCount++;
        throw new Error("fail");
      },
      formatToolMessages() { return []; },
    };

    registerExecutor("retrymock", alwaysFail);
    registerProcessor("retrymock", new MockProcessor());

    const agent = makeAgent();
    const tools = { greet: () => "hi" };

    const promise = turn(agent, { name: "Test" }, { tools: tools as any, maxLlmRetries: 1 });
    const settled = promise.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await settled;
    expect(err).toBeInstanceOf(ExecuteError);
    expect(callCount).toBe(1); // Only one attempt
  });
});

// ---------------------------------------------------------------------------
// Tool Execution Error Safety (§9.9)
// ---------------------------------------------------------------------------

describe("Tool Execution Error Safety (§9.9)", () => {
  beforeEach(() => {
    registerRenderer("mock", new MockRenderer());
    registerParser("mock", new MockParser());
  });

  it("emits error event when tool execution fails", async () => {
    let callCount = 0;
    const toolCallExecutor: Executor = {
      async execute(_agent: Prompty, _messages: Message[]): Promise<unknown> {
        callCount++;
        if (callCount === 1) {
          return {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_1",
                  type: "function",
                  function: { name: "bad_tool", arguments: '{}' },
                }],
              },
            }],
          };
        }
        return { choices: [{ message: { role: "assistant", content: "Recovered" } }] };
      },
      formatToolMessages(
        _rawResponse: unknown,
        toolCalls: { id: string; name: string; arguments: string }[],
        toolResults: ToolResult[],
        textContent = "",
      ): Message[] {
        const messages: Message[] = [];
        const rawToolCalls = toolCalls.map((tc) => ({
          id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments },
        }));
        messages.push(new Message({ role: "assistant", parts: textContent ? [text(textContent)] : [], metadata: { tool_calls: rawToolCalls } }));
        for (let i = 0; i < toolCalls.length; i++) {
          messages.push(new Message({ role: "tool", parts: [text(toolResultText(toolResults[i]))], metadata: { tool_call_id: toolCalls[i].id, name: toolCalls[i].name } }));
        }
        return messages;
      },
    };

    registerExecutor("retrymock", toolCallExecutor);
    registerProcessor("retrymock", new MockProcessor());

    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const onEvent = (type: string, data: Record<string, unknown>) => {
      events.push({ type, data });
    };

    const agent = makeAgent();
    // Tool that throws
    const tools = {
      bad_tool: () => { throw new Error("tool explosion"); },
    };

    const result = await turn(agent, { name: "Test" }, {
      tools: tools as any,
      onEvent: onEvent as any,
      maxLlmRetries: 1,
    });

    // The loop should recover and produce a final result
    expect(result).toBe("Recovered");

    // An error event should have been emitted for the tool failure
    const errorEvents = events.filter(e => e.type === "error");
    expect(errorEvents.length).toBeGreaterThan(0);
    const toolError = errorEvents.find(e => e.data.tool === "bad_tool");
    expect(toolError).toBeDefined();
    expect(toolError!.data.error).toContain("tool explosion");
  });

  it("tool errors are returned as strings, not thrown", async () => {
    let callCount = 0;
    const toolCallExecutor: Executor = {
      async execute(_agent: Prompty, messages: Message[]): Promise<unknown> {
        callCount++;
        if (callCount === 1) {
          return {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_1",
                  type: "function",
                  function: { name: "crashing_tool", arguments: '{"x": 1}' },
                }],
              },
            }],
          };
        }
        // The tool result with the error message gets sent back to LLM
        const lastMsg = messages[messages.length - 1];
        expect(lastMsg.role).toBe("tool");
        expect(messageText(lastMsg)).toContain("Error");
        return { choices: [{ message: { role: "assistant", content: "Handled error" } }] };
      },
      formatToolMessages(
        _rawResponse: unknown,
        toolCalls: { id: string; name: string; arguments: string }[],
        toolResults: ToolResult[],
        textContent = "",
      ): Message[] {
        const messages: Message[] = [];
        const rawToolCalls = toolCalls.map((tc) => ({
          id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments },
        }));
        messages.push(new Message({ role: "assistant", parts: textContent ? [text(textContent)] : [], metadata: { tool_calls: rawToolCalls } }));
        for (let i = 0; i < toolCalls.length; i++) {
          messages.push(new Message({ role: "tool", parts: [text(toolResultText(toolResults[i]))], metadata: { tool_call_id: toolCalls[i].id, name: toolCalls[i].name } }));
        }
        return messages;
      },
    };

    registerExecutor("retrymock", toolCallExecutor);
    registerProcessor("retrymock", new MockProcessor());

    const agent = makeAgent();
    const tools = {
      crashing_tool: () => { throw new Error("BOOM"); },
    };

    // Should NOT throw — error is returned as string to the LLM
    const result = await turn(agent, { name: "Test" }, {
      tools: tools as any,
      maxLlmRetries: 1,
    });
    expect(result).toBe("Handled error");
    expect(callCount).toBe(2);
  });
});

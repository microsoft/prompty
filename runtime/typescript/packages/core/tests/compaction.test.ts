import { describe, it, expect, beforeEach, vi } from "vitest";
import { Message, text, messageText } from "../src/core/types.js";
import { formatDroppedMessages, trimToContextWindow } from "../src/core/context.js";
import { turn } from "../src/core/pipeline.js";
import { emitEvent, type AgentEventType, type EventCallback } from "../src/core/agent-events.js";
import {
  registerRenderer,
  registerParser,
  registerExecutor,
  registerProcessor,
} from "../src/core/registry.js";
import type { Renderer, Parser, Executor, Processor } from "../src/core/interfaces.js";
import { Prompty } from "../src/model/prompty.js";

// ===========================================================================
// formatDroppedMessages
// ===========================================================================

describe("formatDroppedMessages", () => {
  it("formats user and assistant messages as readable text", () => {
    const msgs = [
      new Message({ role: "user", parts: [text("What is AI?")] }),
      new Message({ role: "assistant", parts: [text("AI is artificial intelligence.")] }),
    ];
    const result = formatDroppedMessages(msgs);
    expect(result).toContain("[user]: What is AI?");
    expect(result).toContain("[assistant]: AI is artificial intelligence.");
  });

  it("includes tool calls as Called: name(args)", () => {
    const msgs = [
      new Message({ role: "assistant", parts: [text("Let me check.")], metadata: {
        tool_calls: [
          { name: "get_weather", arguments: '{"city":"Seattle"}' },
        ],
      } }),
    ];
    const result = formatDroppedMessages(msgs);
    expect(result).toContain("[assistant]: Let me check.");
    expect(result).toContain('Called: get_weather({"city":"Seattle"})');
  });

  it("handles function-style tool calls", () => {
    const msgs = [
      new Message({ role: "assistant", parts: [text("Checking...")], metadata: {
        tool_calls: [
          { function: { name: "lookup", arguments: '{"q":"test"}' } },
        ],
      } }),
    ];
    const result = formatDroppedMessages(msgs);
    expect(result).toContain('Called: lookup({"q":"test"})');
  });

  it("returns empty string for empty array", () => {
    expect(formatDroppedMessages([])).toBe("");
  });

  it("skips messages with empty text but includes tool calls", () => {
    const msgs = [
      new Message({ role: "assistant", parts: [], metadata: {
        tool_calls: [{ name: "fn", arguments: "" }],
      } }),
    ];
    const result = formatDroppedMessages(msgs);
    expect(result).toBe("Called: fn()");
  });
});

// ===========================================================================
// Context Compaction in turn()
// ===========================================================================

// Stubs for turn() integration tests
class StubRenderer implements Renderer {
  render(_agent: Prompty, _inputs: Record<string, unknown>): string {
    return "system:\nYou are helpful.\n\nuser:\nHello";
  }
}

class StubParser implements Parser {
  parse(_agent: Prompty, rendered: string): Message[] {
    // Simple two-message output
    return [
      new Message({ role: "system", parts: [text("You are helpful.")] }),
      new Message({ role: "user", parts: [text("Hello")] }),
    ];
  }
}

class StubProcessor implements Processor {
  process(_agent: Prompty, response: unknown): unknown {
    const resp = response as { choices: { message: { content: string } }[] };
    return resp.choices?.[0]?.message?.content ?? response;
  }
}

function makeStubExecutor(fn: (agent: Prompty, messages: Message[]) => Promise<unknown>): Executor {
  return { execute: fn };
}

function makeFinalResponse(content: string) {
  return {
    choices: [{
      finish_reason: "stop",
      message: { role: "assistant", content, tool_calls: null },
    }],
  };
}

function makeTestAgent(): Prompty {
  const agent = new Prompty({
    name: "compact-test",
    instructions: "Hello {{name}}",
  });
  agent.template = { format: { kind: "compact-stub" }, parser: { kind: "compact-stub" } } as any;
  (agent as any).model = { provider: "compact-stub" };
  return agent;
}

describe("Context Compaction", () => {
  let capturedMessages: Message[];

  beforeEach(() => {
    capturedMessages = [];

    registerRenderer("compact-stub", new StubRenderer());
    registerParser("compact-stub", new StubParser());
    registerProcessor("compact-stub", new StubProcessor());
    registerExecutor(
      "compact-stub",
      makeStubExecutor(async (_agent, messages) => {
        capturedMessages = [...messages];
        return makeFinalResponse("The answer is 42");
      }),
    );
  });

  it("function compaction replaces default summary", async () => {
    // Build a parser that returns many messages to exceed the budget
    const longMessages = [
      new Message({ role: "system", parts: [text("System prompt")] }),
      new Message({ role: "user", parts: [text("q1 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a1 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("q2 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a2 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("Final question")] }),
    ];
    registerParser("compact-stub", {
      parse: () => [...longMessages],
    });

    const compactionFn = vi.fn((_dropped: Message[]) => "LLM-quality summary of prior conversation");

    const agent = makeTestAgent();
    await turn(agent, { name: "Alice" }, {
      contextBudget: 300,
      compaction: compactionFn,
    });

    expect(compactionFn).toHaveBeenCalled();
    // The summary message in capturedMessages should contain our custom summary
    const summaryMsg = capturedMessages.find(
      (m) => m.role === "user" && messageText(m).includes("[Context summary:"),
    );
    expect(summaryMsg).toBeDefined();
    expect(messageText(summaryMsg!)).toContain("LLM-quality summary of prior conversation");
  });

  it("async function compaction works", async () => {
    const longMessages = [
      new Message({ role: "system", parts: [text("System prompt")] }),
      new Message({ role: "user", parts: [text("q1 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a1 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("q2 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a2 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("Final question")] }),
    ];
    registerParser("compact-stub", {
      parse: () => [...longMessages],
    });

    const compactionFn = vi.fn(async (_dropped: Message[]) => {
      return "Async compacted summary";
    });

    const agent = makeTestAgent();
    await turn(agent, { name: "Alice" }, {
      contextBudget: 300,
      compaction: compactionFn,
    });

    expect(compactionFn).toHaveBeenCalled();
    const summaryMsg = capturedMessages.find(
      (m) => m.role === "user" && messageText(m).includes("[Context summary:"),
    );
    expect(summaryMsg).toBeDefined();
    expect(messageText(summaryMsg!)).toContain("Async compacted summary");
  });

  it("compaction failure preserves default summary", async () => {
    const longMessages = [
      new Message({ role: "system", parts: [text("System prompt")] }),
      new Message({ role: "user", parts: [text("q1 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a1 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("q2 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a2 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("Final question")] }),
    ];
    registerParser("compact-stub", {
      parse: () => [...longMessages],
    });

    const events: { type: AgentEventType; data: Record<string, unknown> }[] = [];
    const onEvent: EventCallback = (t, d) => events.push({ type: t, data: d });

    const compactionFn = vi.fn(() => {
      throw new Error("Compaction service down");
    });

    const agent = makeTestAgent();
    await turn(agent, { name: "Alice" }, {
      contextBudget: 300,
      compaction: compactionFn,
      onEvent,
    });

    // Default summary should still be present (not replaced)
    const summaryMsg = capturedMessages.find(
      (m) => m.role === "user" && messageText(m).includes("[Context summary:"),
    );
    expect(summaryMsg).toBeDefined();
    // Should NOT contain our custom text since it failed
    expect(messageText(summaryMsg!)).not.toContain("Compaction service down");

    // compaction_failed event should have been emitted
    const failedEvent = events.find((e) => e.type === "compaction_failed");
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.data.reason).toContain("Compaction service down");
  });

  it("compaction events are emitted on success", async () => {
    const longMessages = [
      new Message({ role: "system", parts: [text("System prompt")] }),
      new Message({ role: "user", parts: [text("q1 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a1 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("q2 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a2 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("Final question")] }),
    ];
    registerParser("compact-stub", {
      parse: () => [...longMessages],
    });

    const events: { type: AgentEventType; data: Record<string, unknown> }[] = [];
    const onEvent: EventCallback = (t, d) => events.push({ type: t, data: d });

    const agent = makeTestAgent();
    await turn(agent, { name: "Alice" }, {
      contextBudget: 300,
      compaction: () => "Compact summary here",
      onEvent,
    });

    const startEvent = events.find((e) => e.type === "compaction_start");
    expect(startEvent).toBeDefined();
    expect(startEvent!.data.dropped_count).toBeGreaterThan(0);

    const completeEvent = events.find((e) => e.type === "compaction_complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.data.summary_length).toBe("Compact summary here".length);
  });

  it("no compaction when compaction option is undefined", async () => {
    const longMessages = [
      new Message({ role: "system", parts: [text("System prompt")] }),
      new Message({ role: "user", parts: [text("q1 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a1 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("q2 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a2 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("Final question")] }),
    ];
    registerParser("compact-stub", {
      parse: () => [...longMessages],
    });

    const events: { type: AgentEventType; data: Record<string, unknown> }[] = [];
    const onEvent: EventCallback = (t, d) => events.push({ type: t, data: d });

    const agent = makeTestAgent();
    await turn(agent, { name: "Alice" }, {
      contextBudget: 300,
      onEvent,
      // no compaction option
    });

    // Default summarizeDropped summary should be present
    const summaryMsg = capturedMessages.find(
      (m) => m.role === "user" && messageText(m).includes("[Context summary:"),
    );
    expect(summaryMsg).toBeDefined();

    // No compaction events
    expect(events.find((e) => e.type === "compaction_start")).toBeUndefined();
    expect(events.find((e) => e.type === "compaction_complete")).toBeUndefined();
  });

  it("empty compaction result emits compaction_failed", async () => {
    const longMessages = [
      new Message({ role: "system", parts: [text("System prompt")] }),
      new Message({ role: "user", parts: [text("q1 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a1 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("q2 " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("a2 " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("Final question")] }),
    ];
    registerParser("compact-stub", {
      parse: () => [...longMessages],
    });

    const events: { type: AgentEventType; data: Record<string, unknown> }[] = [];
    const onEvent: EventCallback = (t, d) => events.push({ type: t, data: d });

    const agent = makeTestAgent();
    await turn(agent, { name: "Alice" }, {
      contextBudget: 300,
      compaction: () => "   ",
      onEvent,
    });

    const failedEvent = events.find((e) => e.type === "compaction_failed");
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.data.reason).toBe("empty result");
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { emitEvent, type EventCallback, type AgentEventType } from "../src/core/agent-events.js";
import { checkCancellation, CancelledError } from "../src/core/cancellation.js";
import { estimateChars, summarizeDropped, trimToContextWindow } from "../src/core/context.js";
import { Guardrails, GuardrailError } from "../src/core/guardrails.js";
import { Steering } from "../src/core/steering.js";
import { Message, text } from "../src/core/types.js";
import { turn } from "../src/core/pipeline.js";
import {
  registerRenderer,
  registerParser,
  registerExecutor,
  registerProcessor,
} from "../src/core/registry.js";
import type { Renderer, Parser, Executor, Processor } from "../src/core/interfaces.js";
import { Prompty } from "../src/model/index.js";

// ===========================================================================
// §13.1 Agent Events
// ===========================================================================

describe("emitEvent", () => {
  it("calls callback with correct args", () => {
    const cb = vi.fn<EventCallback>();
    const data = { iteration: 1 };
    emitEvent(cb, "status", data);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith("status", data);
  });

  it("silently swallows exceptions from callback", () => {
    const cb = vi.fn<EventCallback>().mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => emitEvent(cb, "error", { msg: "bad" })).not.toThrow();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("is a no-op if callback is undefined", () => {
    expect(() => emitEvent(undefined, "done", {})).not.toThrow();
  });
});

// ===========================================================================
// §13.2 Cancellation
// ===========================================================================

describe("checkCancellation", () => {
  it("does nothing with no signal", () => {
    expect(() => checkCancellation()).not.toThrow();
  });

  it("does nothing when signal is not aborted", () => {
    const controller = new AbortController();
    expect(() => checkCancellation(controller.signal)).not.toThrow();
  });

  it("throws CancelledError when signal is aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => checkCancellation(controller.signal)).toThrow(CancelledError);
  });
});

describe("CancelledError", () => {
  it("has correct name and message", () => {
    const err = new CancelledError();
    expect(err.name).toBe("CancelledError");
    expect(err.message).toBe("Agent loop cancelled");
    expect(err).toBeInstanceOf(Error);
  });

  it("accepts a custom message", () => {
    const err = new CancelledError("custom cancel");
    expect(err.message).toBe("custom cancel");
  });
});

// ===========================================================================
// §13.3 Context Window Management
// ===========================================================================

describe("estimateChars", () => {
  it("counts text parts correctly", () => {
    const msgs = [new Message({ role: "user", parts: [text("Hello")] })];
    // "user".length (4) + 4 overhead + "Hello".length (5) = 13
    expect(estimateChars(msgs)).toBe(13);
  });

  it("adds 200 for non-text parts", () => {
    const msgs = [
      new Message({ role: "user", parts: [{ kind: "image", source: "data:image/png;base64,abc" }] }),
    ];
    // "user".length (4) + 4 overhead + 200 (non-text) = 208
    expect(estimateChars(msgs)).toBe(208);
  });

  it("includes role length + 4 overhead per message", () => {
    const msgs = [
      new Message({ role: "system", parts: [text("Hi")] }),
      new Message({ role: "assistant", parts: [text("OK")] }),
    ];
    // "system"(6) + 4 + "Hi"(2) = 12
    // "assistant"(9) + 4 + "OK"(2) = 15
    expect(estimateChars(msgs)).toBe(12 + 15);
  });

  it("counts tool_calls metadata", () => {
    const tc = [{ name: "fn", arguments: "{}" }];
    const msgs = [new Message({ role: "assistant", parts: [text("x")], metadata: { tool_calls: tc } })];
    const base = "assistant".length + 4 + 1; // role + overhead + "x"
    const tcLen = JSON.stringify(tc).length;
    expect(estimateChars(msgs)).toBe(base + tcLen);
  });
});

describe("summarizeDropped", () => {
  it("creates summary from user/assistant messages", () => {
    const msgs = [
      new Message({ role: "user", parts: [text("What is AI?")] }),
      new Message({ role: "assistant", parts: [text("AI is artificial intelligence.")] }),
    ];
    const result = summarizeDropped(msgs);
    expect(result).toContain("[Context summary:");
    expect(result).toContain("User asked:");
    expect(result).toContain("Assistant:");
    expect(result).toContain("]");
  });

  it("returns empty string for empty array", () => {
    expect(summarizeDropped([])).toBe("");
  });

  it("includes tool call names in summary", () => {
    const msgs = [
      new Message({ role: "assistant", parts: [text("Let me check.")], metadata: {
        tool_calls: [{ name: "get_weather" }],
      } }),
    ];
    const result = summarizeDropped(msgs);
    expect(result).toContain("get_weather");
  });
});

describe("trimToContextWindow", () => {
  it("returns [0, []] when within budget", () => {
    const msgs = [new Message({ role: "user", parts: [text("Hi")] })];
    const [count, dropped] = trimToContextWindow(msgs, 100_000);
    expect(count).toBe(0);
    expect(dropped).toEqual([]);
  });

  it("drops oldest non-system messages when over budget", () => {
    const msgs = [
      new Message({ role: "system", parts: [text("You are helpful.")] }),
      new Message({ role: "user", parts: [text("First question " + "x".repeat(500))] }),
      new Message({ role: "assistant", parts: [text("First answer " + "x".repeat(500))] }),
      new Message({ role: "user", parts: [text("Second question")] }),
      new Message({ role: "assistant", parts: [text("Second answer")] }),
    ];
    // Budget is small enough to force drops but big enough to keep system + last 2
    const [count, dropped] = trimToContextWindow(msgs, 200);
    expect(count).toBeGreaterThan(0);
    expect(dropped.length).toBeGreaterThan(0);
    // System message must still be first
    expect(msgs[0].role).toBe("system");
  });

  it("preserves system messages", () => {
    const msgs = [
      new Message({ role: "system", parts: [text("System prompt")] }),
      new Message({ role: "user", parts: [text("a".repeat(1000))] }),
      new Message({ role: "assistant", parts: [text("b".repeat(1000))] }),
      new Message({ role: "user", parts: [text("c".repeat(1000))] }),
      new Message({ role: "assistant", parts: [text("d".repeat(1000))] }),
    ];
    trimToContextWindow(msgs, 300);
    // System messages must survive trimming
    expect(msgs.some((m) => m.role === "system")).toBe(true);
    expect(msgs[0].role).toBe("system");
  });
});

// ===========================================================================
// §13.4 Guardrails
// ===========================================================================

describe("Guardrails", () => {
  it("with no hooks always allows", () => {
    const g = new Guardrails();
    expect(g.checkInput([new Message({ role: "user", parts: [text("hi")] })])).toEqual({ allowed: true });
    expect(g.checkOutput(new Message({ role: "assistant", parts: [text("ok")] }))).toEqual({ allowed: true });
    expect(g.checkTool("fn", {})).toEqual({ allowed: true });
  });

  it("checkInput calls input hook and returns result", () => {
    const g = new Guardrails({
      input: (msgs) => {
        if (msgs.some((m) => m.text.includes("bad"))) {
          return { allowed: false, reason: "bad input" };
        }
        return { allowed: true };
      },
    });
    expect(g.checkInput([new Message({ role: "user", parts: [text("hello")] })])).toEqual({ allowed: true });
    expect(g.checkInput([new Message({ role: "user", parts: [text("bad stuff")] })])).toEqual({
      allowed: false,
      reason: "bad input",
    });
  });

  it("checkOutput calls output hook and returns result", () => {
    const g = new Guardrails({
      output: (msg) => {
        if (msg.text.includes("secret")) {
          return { allowed: false, reason: "leaked secret" };
        }
        return { allowed: true };
      },
    });
    expect(g.checkOutput(new Message({ role: "assistant", parts: [text("fine")] }))).toEqual({ allowed: true });
    expect(g.checkOutput(new Message({ role: "assistant", parts: [text("the secret is...")] }))).toEqual({
      allowed: false,
      reason: "leaked secret",
    });
  });

  it("checkTool calls tool hook and returns result", () => {
    const g = new Guardrails({
      tool: (name, _args) => {
        if (name === "dangerous") return { allowed: false, reason: "blocked tool" };
        return { allowed: true };
      },
    });
    expect(g.checkTool("safe_fn", {})).toEqual({ allowed: true });
    expect(g.checkTool("dangerous", {})).toEqual({ allowed: false, reason: "blocked tool" });
  });
});

describe("GuardrailError", () => {
  it("has correct name and reason", () => {
    const err = new GuardrailError("policy violation");
    expect(err.name).toBe("GuardrailError");
    expect(err.reason).toBe("policy violation");
    expect(err.message).toContain("policy violation");
    expect(err).toBeInstanceOf(Error);
  });
});

// ===========================================================================
// §13.5 Steering
// ===========================================================================

describe("Steering", () => {
  let steering: Steering;

  beforeEach(() => {
    steering = new Steering();
  });

  it("send + drain returns messages", () => {
    steering.send("Hello agent");
    const drained = steering.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toBeInstanceOf(Message);
    expect(drained[0].role).toBe("user");
    expect(drained[0].text).toBe("Hello agent");
  });

  it("drain empties the queue", () => {
    steering.send("msg1");
    steering.send("msg2");
    const first = steering.drain();
    expect(first).toHaveLength(2);
    const second = steering.drain();
    expect(second).toHaveLength(0);
  });

  it("hasPending returns true when messages queued", () => {
    expect(steering.hasPending).toBe(false);
    steering.send("test");
    expect(steering.hasPending).toBe(true);
  });

  it("hasPending returns false after drain", () => {
    steering.send("test");
    steering.drain();
    expect(steering.hasPending).toBe(false);
  });

  it("multiple sends are drained in order", () => {
    steering.send("first");
    steering.send("second");
    steering.send("third");
    const drained = steering.drain();
    expect(drained).toHaveLength(3);
    expect(drained[0].text).toBe("first");
    expect(drained[1].text).toBe("second");
    expect(drained[2].text).toBe("third");
  });
});

// ===========================================================================
// turn integration — §13 extension hooks in the agent loop
// ===========================================================================

// --- Mock implementations for integration tests ---

class StubRenderer implements Renderer {
  async render(_agent: Prompty, template: string, inputs: Record<string, unknown>): Promise<string> {
    let result = template;
    for (const [key, val] of Object.entries(inputs)) {
      result = result.replace(`{{${key}}}`, String(val));
    }
    return result;
  }
}

class StubParser implements Parser {
  async parse(_agent: Prompty, rendered: string): Promise<Message[]> {
    return [new Message({ role: "user", parts: [text(rendered)] })];
  }
}

/** Processor that extracts content from a standard OpenAI chat response shape. */
class StubProcessor implements Processor {
  async process(_agent: Prompty, response: unknown): Promise<unknown> {
    const r = response as Record<string, unknown>;
    const choices = r.choices as Record<string, unknown>[];
    const msg = choices[0].message as Record<string, unknown>;
    return msg.content;
  }
}

/** Helper to build a minimal mock executor with configurable execute(). */
function makeStubExecutor(executeFn: (agent: Prompty, messages: Message[]) => Promise<unknown>): Executor {
  return {
    execute: executeFn,
    formatToolMessages(
      _rawResponse: unknown,
      toolCalls: { id: string; name: string; arguments: string }[],
      toolResults: string[],
      textContent = "",
    ): Message[] {
      const messages: Message[] = [];
      const rawToolCalls = toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));
      messages.push(
        new Message({ role: "assistant", parts: textContent ? [text(textContent)] : [], metadata: {
          tool_calls: rawToolCalls,
        } }),
      );
      for (let i = 0; i < toolCalls.length; i++) {
        messages.push(
          new Message({ role: "tool", parts: [text(toolResults[i])], metadata: {
            tool_call_id: toolCalls[i].id,
            name: toolCalls[i].name,
          } }),
        );
      }
      return messages;
    },
  };
}

/** Build a final (no tool calls) response. */
function makeFinalResponse(content: string) {
  return {
    choices: [{
      finish_reason: "stop",
      message: { role: "assistant", content, tool_calls: null },
    }],
  };
}

/** Build a tool-call response. */
function makeToolCallResponse(calls: { id: string; name: string; args: string }[], content: string | null = null) {
  return {
    choices: [{
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.args },
        })),
      },
    }],
  };
}

function makeTestAgent(): Prompty {
  const agent = new Prompty({
    name: "ext-test",
    instructions: "Hello {{name}}",
  });
  agent.template = { format: { kind: "ext-stub" }, parser: { kind: "ext-stub" } } as any;
  (agent as any).model = { provider: "ext-stub" };
  return agent;
}

describe("turn integration", () => {
  /** Messages captured by the executor during execute(). */
  let capturedMessages: Message[];
  /** How many times execute() was called. */
  let executeCallCount: number;

  beforeEach(() => {
    capturedMessages = [];
    executeCallCount = 0;

    registerRenderer("ext-stub", new StubRenderer());
    registerParser("ext-stub", new StubParser());
    registerProcessor("ext-stub", new StubProcessor());
    // Default executor: returns a final response and captures messages
    registerExecutor(
      "ext-stub",
      makeStubExecutor(async (_agent, messages) => {
        executeCallCount++;
        capturedMessages = [...messages];
        return makeFinalResponse("The answer is 42");
      }),
    );
  });

  // ---- §13.4 Input guardrail: first-turn denial ----
  it("input guardrail denial prevents executor call", async () => {
    const guardrails = new Guardrails({
      input: () => ({ allowed: false, reason: "policy violation" }),
    });

    const agent = makeTestAgent();
    await expect(
      turn(agent, { name: "Alice" }, { guardrails }),
    ).rejects.toThrow(GuardrailError);

    expect(executeCallCount).toBe(0);
  });

  // ---- §13.5 Steering on first turn ----
  it("steering messages appear in first LLM call", async () => {
    const steering = new Steering();
    steering.send("Extra context from steering");

    const agent = makeTestAgent();
    await turn(agent, { name: "Bob" }, { steering });

    // The prepared message is "Hello Bob" from template, then steering appends
    expect(capturedMessages.length).toBeGreaterThanOrEqual(2);
    const allText = capturedMessages.map((m) => m.text).join(" | ");
    expect(allText).toContain("Extra context from steering");
  });

  // ---- §13.3 Context trim before first call ----
  it("trims long messages before calling executor", async () => {
    // Use an executor that captures messages
    registerExecutor(
      "ext-stub",
      makeStubExecutor(async (_agent, messages) => {
        executeCallCount++;
        capturedMessages = [...messages];
        return makeFinalResponse("ok");
      }),
    );

    // Parser returns very long messages to trigger trimming
    const longParser: Parser = {
      async parse(_agent: Prompty, _rendered: string): Promise<Message[]> {
        return [
          new Message({ role: "system", parts: [text("System prompt")] }),
          new Message({ role: "user", parts: [text("A".repeat(2000))] }),
          new Message({ role: "assistant", parts: [text("B".repeat(2000))] }),
          new Message({ role: "user", parts: [text("C".repeat(2000))] }),
          new Message({ role: "assistant", parts: [text("D".repeat(2000))] }),
          new Message({ role: "user", parts: [text("Final question")] }),
        ];
      },
    };
    registerParser("ext-stub", longParser);

    const agent = makeTestAgent();
    await turn(agent, { name: "X" }, { contextBudget: 500 });

    // Some messages should have been dropped; system should remain
    expect(capturedMessages[0].role).toBe("system");
    // Total characters should be reduced
    const totalChars = capturedMessages.reduce(
      (sum, m) => sum + m.text.length,
      0,
    );
    expect(totalChars).toBeLessThan(8000 + 14);
  });

  // ---- §13.4 Input guardrail rewrite ----
  it("input guardrail rewrite replaces messages sent to executor", async () => {
    const replacement = [new Message({ role: "user", parts: [text("Rewritten input")] })];
    const guardrails = new Guardrails({
      input: () => ({ allowed: true, rewrite: replacement }),
    });

    const agent = makeTestAgent();
    await turn(agent, { name: "Carol" }, { guardrails });

    expect(capturedMessages).toHaveLength(1);
    expect(capturedMessages[0].text).toBe("Rewritten input");
  });

  // ---- §13.4 Output guardrail: denial on final response ----
  it("output guardrail denies final response", async () => {
    const guardrails = new Guardrails({
      output: (msg) => {
        if (msg.text.includes("42")) {
          return { allowed: false, reason: "forbidden number" };
        }
        return { allowed: true };
      },
    });

    const agent = makeTestAgent();
    await expect(
      turn(agent, { name: "Eve" }, { guardrails }),
    ).rejects.toThrow(GuardrailError);
  });

  // ---- §13.4 Output guardrail: rewrite on final response ----
  it("output guardrail rewrites final response", async () => {
    const guardrails = new Guardrails({
      output: () => ({ allowed: true, rewrite: "Redacted answer" }),
    });

    const agent = makeTestAgent();
    const result = await turn(agent, { name: "Frank" }, { guardrails });
    expect(result).toBe("Redacted answer");
  });

  // ---- §13.4 Tool guardrail rewrite ----
  it("tool guardrail rewrites arguments before tool execution", async () => {
    let receivedArgs: Record<string, unknown> = {};
    let callNum = 0;

    registerExecutor(
      "ext-stub",
      makeStubExecutor(async (_agent, messages) => {
        callNum++;
        capturedMessages = [...messages];
        if (callNum === 1) {
          return makeToolCallResponse([
            { id: "c1", name: "get_weather", args: '{"city":"Seattle"}' },
          ]);
        }
        return makeFinalResponse("Done");
      }),
    );

    const guardrails = new Guardrails({
      tool: (name, args) => {
        if (name === "get_weather") {
          return { allowed: true, rewrite: { city: "Portland" } };
        }
        return { allowed: true };
      },
    });

    const tools = {
      get_weather: (args: Record<string, unknown>) => {
        receivedArgs = args;
        return `72°F in ${args.city}`;
      },
    };

    const agent = makeTestAgent();
    await turn(agent, { name: "G" }, { tools: tools as any, guardrails });

    expect(receivedArgs.city).toBe("Portland");
  });

  // ---- §13.2 Cancellation mid-loop ----
  it("cancellation aborts the loop", async () => {
    const controller = new AbortController();
    let callNum = 0;

    registerExecutor(
      "ext-stub",
      makeStubExecutor(async (_agent, _messages) => {
        callNum++;
        if (callNum === 1) {
          // After first LLM call returns tool calls, abort before next iteration
          controller.abort();
          return makeToolCallResponse([
            { id: "c1", name: "noop", args: "{}" },
          ]);
        }
        return makeFinalResponse("should not reach");
      }),
    );

    const tools = { noop: () => "ok" };
    const agent = makeTestAgent();

    await expect(
      turn(agent, { name: "H" }, {
        tools: tools as any,
        signal: controller.signal,
      }),
    ).rejects.toThrow(CancelledError);

    expect(callNum).toBe(1);
  });

  // ---- §13 Max iterations exceeded ----
  it("throws when maxIterations exceeded", async () => {
    registerExecutor(
      "ext-stub",
      makeStubExecutor(async () =>
        makeToolCallResponse([{ id: "cx", name: "loop_tool", args: "{}" }]),
      ),
    );

    const tools = { loop_tool: () => "looping" };
    const agent = makeTestAgent();

    await expect(
      turn(agent, { name: "I" }, {
        tools: tools as any,
        maxIterations: 2,
      }),
    ).rejects.toThrow("maxIterations");
  });
});

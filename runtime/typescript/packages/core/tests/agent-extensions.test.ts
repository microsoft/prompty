import { describe, it, expect, beforeEach, vi } from "vitest";
import { emitEvent, type EventCallback, type AgentEventType } from "../src/core/agent-events.js";
import { checkCancellation, CancelledError } from "../src/core/cancellation.js";
import { estimateChars, summarizeDropped, trimToContextWindow } from "../src/core/context.js";
import { Guardrails, GuardrailError } from "../src/core/guardrails.js";
import { Steering } from "../src/core/steering.js";
import { Message, text } from "../src/core/types.js";

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
    const msgs = [new Message("user", [text("Hello")])];
    // "user".length (4) + 4 overhead + "Hello".length (5) = 13
    expect(estimateChars(msgs)).toBe(13);
  });

  it("adds 200 for non-text parts", () => {
    const msgs = [
      new Message("user", [{ kind: "image", source: "data:image/png;base64,abc" }]),
    ];
    // "user".length (4) + 4 overhead + 200 (non-text) = 208
    expect(estimateChars(msgs)).toBe(208);
  });

  it("includes role length + 4 overhead per message", () => {
    const msgs = [
      new Message("system", [text("Hi")]),
      new Message("assistant", [text("OK")]),
    ];
    // "system"(6) + 4 + "Hi"(2) = 12
    // "assistant"(9) + 4 + "OK"(2) = 15
    expect(estimateChars(msgs)).toBe(12 + 15);
  });

  it("counts tool_calls metadata", () => {
    const tc = [{ name: "fn", arguments: "{}" }];
    const msgs = [new Message("assistant", [text("x")], { tool_calls: tc })];
    const base = "assistant".length + 4 + 1; // role + overhead + "x"
    const tcLen = JSON.stringify(tc).length;
    expect(estimateChars(msgs)).toBe(base + tcLen);
  });
});

describe("summarizeDropped", () => {
  it("creates summary from user/assistant messages", () => {
    const msgs = [
      new Message("user", [text("What is AI?")]),
      new Message("assistant", [text("AI is artificial intelligence.")]),
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
      new Message("assistant", [text("Let me check.")], {
        tool_calls: [{ name: "get_weather" }],
      }),
    ];
    const result = summarizeDropped(msgs);
    expect(result).toContain("get_weather");
  });
});

describe("trimToContextWindow", () => {
  it("returns [0, []] when within budget", () => {
    const msgs = [new Message("user", [text("Hi")])];
    const [count, dropped] = trimToContextWindow(msgs, 100_000);
    expect(count).toBe(0);
    expect(dropped).toEqual([]);
  });

  it("drops oldest non-system messages when over budget", () => {
    const msgs = [
      new Message("system", [text("You are helpful.")]),
      new Message("user", [text("First question " + "x".repeat(500))]),
      new Message("assistant", [text("First answer " + "x".repeat(500))]),
      new Message("user", [text("Second question")]),
      new Message("assistant", [text("Second answer")]),
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
      new Message("system", [text("System prompt")]),
      new Message("user", [text("a".repeat(1000))]),
      new Message("assistant", [text("b".repeat(1000))]),
      new Message("user", [text("c".repeat(1000))]),
      new Message("assistant", [text("d".repeat(1000))]),
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
    expect(g.checkInput([new Message("user", [text("hi")])])).toEqual({ allowed: true });
    expect(g.checkOutput(new Message("assistant", [text("ok")]))).toEqual({ allowed: true });
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
    expect(g.checkInput([new Message("user", [text("hello")])])).toEqual({ allowed: true });
    expect(g.checkInput([new Message("user", [text("bad stuff")])])).toEqual({
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
    expect(g.checkOutput(new Message("assistant", [text("fine")]))).toEqual({ allowed: true });
    expect(g.checkOutput(new Message("assistant", [text("the secret is...")]))).toEqual({
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

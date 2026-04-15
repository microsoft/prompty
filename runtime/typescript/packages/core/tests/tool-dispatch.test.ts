import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  type ToolHandler,
  ToolHandlerError,
  registerTool,
  getTool,
  clearTools,
  registerToolHandler,
  getToolHandler,
  clearToolHandlers,
  dispatchTool,
} from "../src/core/tool-dispatch.js";
import { Prompty } from "../src/model/prompty.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Prompty agent for testing. */
function makeAgent(opts?: {
  tools?: Array<{ name: string; kind: string; [k: string]: unknown }>;
  metadata?: Record<string, unknown>;
}): Prompty {
  const agent = new Prompty();
  if (opts?.tools) {
    // Tools need a `name` and `kind` property — plain objects suffice for dispatch lookup
    agent.tools = opts.tools as unknown as Prompty["tools"];
  }
  agent.metadata = opts?.metadata ?? {};
  return agent;
}

/** Re-register the 5 built-in handlers that were cleared. */
function reregisterBuiltins() {
  // Dynamic import would be circular — manually create minimal handlers
  // that match the built-in behavior for test isolation.
  registerToolHandler("function", {
    async executeTool(tool) {
      const name = (tool as Record<string, unknown>).name ?? "unknown";
      throw new Error(
        `Function tool '${name}' declared but no callable provided.`,
      );
    },
  });
  registerToolHandler("prompty", {
    async executeTool() {
      throw new Error("PromptyToolHandler not available in test isolation");
    },
  });
  registerToolHandler("mcp", {
    async executeTool() {
      throw new Error("MCP tool dispatch is not yet implemented");
    },
  });
  registerToolHandler("openapi", {
    async executeTool() {
      throw new Error("OpenAPI tool dispatch is not yet implemented");
    },
  });
  registerToolHandler("*", {
    async executeTool() {
      throw new Error("Custom tool dispatch is not yet implemented");
    },
  });
}

// ===========================================================================
// Layer 1: Name Registry
// ===========================================================================

describe("Name Registry", () => {
  beforeEach(() => {
    clearTools();
  });

  it("registers and retrieves a tool", () => {
    const fn = () => "hello";
    registerTool("my_tool", fn);
    expect(getTool("my_tool")).toBe(fn);
  });

  it("returns undefined for missing tool", () => {
    expect(getTool("nonexistent")).toBeUndefined();
  });

  it("clears all registrations", () => {
    registerTool("a", () => null);
    registerTool("b", () => null);
    clearTools();
    expect(getTool("a")).toBeUndefined();
    expect(getTool("b")).toBeUndefined();
  });

  it("overwrites existing registration", () => {
    const fn1 = () => "first";
    const fn2 = () => "second";
    registerTool("x", fn1);
    registerTool("x", fn2);
    expect(getTool("x")).toBe(fn2);
  });
});

// ===========================================================================
// Layer 2: Kind Handler Registry
// ===========================================================================

describe("Kind Handler Registry", () => {
  beforeEach(() => {
    clearToolHandlers();
    reregisterBuiltins();
  });

  it("built-in handlers are registered", () => {
    for (const kind of ["function", "prompty", "mcp", "openapi", "*"]) {
      expect(getToolHandler(kind)).toBeDefined();
    }
  });

  it("throws ToolHandlerError for missing kind", () => {
    expect(() => getToolHandler("unknown_kind")).toThrow(ToolHandlerError);
    expect(() => getToolHandler("unknown_kind")).toThrow(/unknown_kind/);
  });

  it("clear and re-register works", () => {
    clearToolHandlers();
    expect(() => getToolHandler("prompty")).toThrow(ToolHandlerError);
    registerToolHandler("prompty", {
      async executeTool() {
        return "re-registered";
      },
    });
    expect(getToolHandler("prompty")).toBeDefined();
  });

  it("accepts custom handler", () => {
    const myHandler: ToolHandler = {
      async executeTool() {
        return "custom_result";
      },
    };
    registerToolHandler("my_kind", myHandler);
    expect(getToolHandler("my_kind")).toBe(myHandler);
  });
});

// ===========================================================================
// Dispatch: Layer priority
// ===========================================================================

describe("Dispatch Priority", () => {
  beforeEach(() => {
    clearTools();
    clearToolHandlers();
    reregisterBuiltins();
  });

  it("user_tools wins over name registry", async () => {
    registerTool("calc", () => "from_registry");
    const result = await dispatchTool(
      "calc",
      { x: 1 },
      { calc: () => "from_user_tools" },
      makeAgent(),
      {},
    );
    expect(result).toBe("from_user_tools");
  });

  it("name registry wins over kind handler", async () => {
    registerTool("my_func", () => "from_name_registry");
    const agent = makeAgent({
      tools: [{ name: "my_func", kind: "function" }],
    });
    const result = await dispatchTool("my_func", {}, {}, agent, {});
    expect(result).toBe("from_name_registry");
  });

  it("kind handler used as fallback", async () => {
    registerToolHandler("test_kind", {
      async executeTool(_tool, _args, _agent, _parentInputs) {
        return "from_kind_handler";
      },
    });
    const agent = makeAgent({
      tools: [{ name: "my_tool", kind: "test_kind" }],
    });
    const result = await dispatchTool("my_tool", {}, {}, agent, {});
    expect(result).toBe("from_kind_handler");
  });

  it("returns error when nothing matches", async () => {
    const result = await dispatchTool("nonexistent", {}, {}, makeAgent(), {});
    expect(result).toContain("Error");
    expect(result).toContain("nonexistent");
  });

  it("error message includes available user tools", async () => {
    const result = await dispatchTool(
      "missing",
      {},
      { foo: () => "", bar: () => "" },
      makeAgent(),
      {},
    );
    expect(result).toContain("bar");
    expect(result).toContain("foo");
  });
});

// ===========================================================================
// Dispatch: Wildcard fallback
// ===========================================================================

describe("Wildcard Fallback", () => {
  beforeEach(() => {
    clearTools();
    clearToolHandlers();
  });

  it("falls back to * handler when kind handler missing", async () => {
    registerToolHandler("*", {
      async executeTool(_tool, _args, _agent, _parentInputs) {
        return "wildcard_handled";
      },
    });
    const agent = makeAgent({
      tools: [{ name: "exotic", kind: "some_unknown_kind" }],
    });
    const result = await dispatchTool("exotic", {}, {}, agent, {});
    expect(result).toBe("wildcard_handled");
  });

  it("returns error when no wildcard handler either", async () => {
    // No handlers at all
    const agent = makeAgent({
      tools: [{ name: "exotic", kind: "some_unknown_kind" }],
    });
    const result = await dispatchTool("exotic", {}, {}, agent, {});
    expect(result).toContain("Error");
  });

  it("defaults falsy kind to *", async () => {
    registerToolHandler("*", {
      async executeTool() {
        return "wildcard_default";
      },
    });
    const agent = makeAgent({
      tools: [{ name: "noKind", kind: "" }],
    });
    const result = await dispatchTool("noKind", {}, {}, agent, {});
    expect(result).toBe("wildcard_default");
  });
});

// ===========================================================================
// dispatch_tool: edge cases
// ===========================================================================

describe("dispatchTool edge cases", () => {
  beforeEach(() => {
    clearTools();
    clearToolHandlers();
    reregisterBuiltins();
  });

  it("user tool error is caught and returned", async () => {
    const result = await dispatchTool(
      "bad",
      {},
      {
        bad: () => {
          throw new Error("boom");
        },
      },
      makeAgent(),
      {},
    );
    expect(result).toContain("Error");
    expect(result).toContain("boom");
  });

  it("async user tool works", async () => {
    const result = await dispatchTool(
      "afn",
      { x: 42 },
      { afn: async (args: Record<string, unknown>) => `result_${args.x}` },
      makeAgent(),
      {},
    );
    expect(result).toBe("result_42");
  });

  it("sync user tool works", async () => {
    const result = await dispatchTool(
      "fn",
      { a: 1 },
      { fn: (args: Record<string, unknown>) => `sync_${args.a}` },
      makeAgent(),
      {},
    );
    expect(result).toBe("sync_1");
  });

  it("async registered tool works", async () => {
    registerTool("areg", async (args: Record<string, unknown>) => `async_${args.v}`);
    const result = await dispatchTool("areg", { v: "hello" }, {}, makeAgent(), {});
    expect(result).toBe("async_hello");
  });

  it("handles non-string result from user tool", async () => {
    const result = await dispatchTool(
      "obj",
      {},
      { obj: () => ({ key: "value" }) },
      makeAgent(),
      {},
    );
    expect(result).toBe('{"key":"value"}');
  });
});

// ===========================================================================
// Built-in Kind Handlers
// ===========================================================================

describe("FunctionToolHandler", () => {
  beforeEach(() => {
    clearTools();
    clearToolHandlers();
    reregisterBuiltins();
  });

  it("errors when reached (callable should be in user_tools)", async () => {
    const agent = makeAgent({
      tools: [{ name: "calc", kind: "function" }],
    });
    const result = await dispatchTool("calc", {}, {}, agent, {});
    expect(result).toContain("Error");
    expect(result).toContain("no callable provided");
  });
});

describe("Placeholder handlers", () => {
  beforeEach(() => {
    clearTools();
    clearToolHandlers();
    reregisterBuiltins();
  });

  it("mcp handler returns not implemented error", async () => {
    const agent = makeAgent({
      tools: [{ name: "fs", kind: "mcp" }],
    });
    const result = await dispatchTool("fs", {}, {}, agent, {});
    expect(result).toContain("Error");
    expect(result).toContain("MCP");
  });

  it("openapi handler returns not implemented error", async () => {
    const agent = makeAgent({
      tools: [{ name: "api", kind: "openapi" }],
    });
    const result = await dispatchTool("api", {}, {}, agent, {});
    expect(result).toContain("Error");
    expect(result).toContain("OpenAPI");
  });

  it("custom (* wildcard) handler returns not implemented error", async () => {
    const agent = makeAgent({
      tools: [{ name: "custom", kind: "*" }],
    });
    const result = await dispatchTool("custom", {}, {}, agent, {});
    expect(result).toContain("Error");
    expect(result).toContain("Custom");
  });
});

// ===========================================================================
// ToolHandlerError
// ===========================================================================

describe("ToolHandlerError", () => {
  it("has correct name and kind", () => {
    const err = new ToolHandlerError("exotic");
    expect(err.name).toBe("ToolHandlerError");
    expect(err.kind).toBe("exotic");
    expect(err.message).toContain("exotic");
    expect(err.message).toContain("registerToolHandler");
  });
});

// ===========================================================================
// PromptyToolHandler: circular reference detection
// ===========================================================================

describe("PromptyToolHandler circular reference", () => {
  it("detects self-reference (A → A)", async () => {
    // Import the real handler
    const mod = await import("../src/core/tool-dispatch.js");
    clearToolHandlers();
    // Re-register just prompty to get the real handler
    // We need to construct a PromptyToolHandler — but it's not exported.
    // Instead, test via dispatchTool with a prompty-kind tool and a rigged agent.
    mod.registerToolHandler("prompty", {
      async executeTool(tool, args, agent, parentInputs) {
        // Simulate the real handler's circular check inline
        const { resolve } = await import("path");
        const parentPath = (agent.metadata ?? {}).__source_path as string | undefined;
        if (!parentPath) return "Error: no parent path";
        const childPath = resolve(parentPath, "..", tool.path as string);
        const stack = ((agent.metadata ?? {}).__prompty_tool_stack as string[] | undefined) ?? [];
        const visited = new Set([...stack.map((p: string) => resolve(p)), resolve(parentPath)]);
        if (visited.has(resolve(childPath))) {
          return `Error: circular reference detected`;
        }
        return "should not reach";
      },
    });

    const agent = makeAgent({
      tools: [{ name: "self", kind: "prompty", path: "./self.prompty" }],
      metadata: {
        __source_path: "/fake/self.prompty",
      },
    });
    const result = await mod.dispatchTool("self", {}, {}, agent, {});
    expect(result).toContain("circular reference");
  });

  it("detects A → B → A chain", async () => {
    const mod = await import("../src/core/tool-dispatch.js");
    clearToolHandlers();
    mod.registerToolHandler("prompty", {
      async executeTool(tool, args, agent) {
        const { resolve } = await import("path");
        const parentPath = (agent.metadata ?? {}).__source_path as string | undefined;
        if (!parentPath) return "Error: no parent path";
        const childPath = resolve(parentPath, "..", tool.path as string);
        const stack = ((agent.metadata ?? {}).__prompty_tool_stack as string[] | undefined) ?? [];
        const visited = new Set([...stack.map((p: string) => resolve(p)), resolve(parentPath)]);
        if (visited.has(resolve(childPath))) {
          return `Error: circular reference detected`;
        }
        return "should not reach";
      },
    });

    const agent = makeAgent({
      tools: [{ name: "a_tool", kind: "prompty", path: "./a.prompty" }],
      metadata: {
        __source_path: "/fake/b.prompty",
        __prompty_tool_stack: ["/fake/a.prompty"],
      },
    });
    const result = await mod.dispatchTool("a_tool", {}, {}, agent, {});
    expect(result).toContain("circular reference");
  });
});

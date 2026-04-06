import { describe, it, expect, beforeEach } from "vitest";
import {
  executeAgent,
} from "../src/core/pipeline.js";
import {
  registerRenderer,
  registerParser,
  registerExecutor,
  registerProcessor,
} from "../src/core/registry.js";
import { Message, text } from "../src/core/types.js";
import { Prompty } from "@prompty/core";
import { Tool } from "../src/model/tool.js";
import { Binding } from "../src/model/binding.js";
import { Property } from "../src/model/property.js";
import type { Renderer, Parser, Executor, Processor } from "../src/core/interfaces.js";

// ---------------------------------------------------------------------------
// resolveBindings — exported for direct testing
// ---------------------------------------------------------------------------
import { resolveBindings } from "../src/core/pipeline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides?: Partial<{
  name: string;
  model: string;
  instructions: string;
  tools: Tool[];
  inputs: Property[];
}>): Prompty {
  const agent = new Prompty({
    name: overrides?.name ?? "test",
    model: overrides?.model ?? "gpt-4o",
    instructions: overrides?.instructions ?? "Hello, {{name}}!",
  });
  if (overrides?.tools) agent.tools = overrides.tools;
  if (overrides?.inputs) agent.inputs = overrides.inputs;
  return agent;
}

function makeTool(name: string, bindings?: Array<{ name: string; input: string }>): Tool {
  const tool = Tool.load({
    name,
    kind: "function",
    description: `Tool ${name}`,
    parameters: [
      { name: "city", kind: "string" },
      { name: "unit", kind: "string" },
    ],
  }) as Tool;
  if (bindings) {
    tool.bindings = bindings.map((b) => new Binding(b));
  }
  return tool;
}

// ---------------------------------------------------------------------------
// Mock implementations
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
    return [new Message("user", [text(rendered)])];
  }
}

class MockProcessor implements Processor {
  async process(_agent: Prompty, response: unknown): Promise<unknown> {
    const r = response as Record<string, unknown>;
    const choices = r.choices as Array<Record<string, Record<string, unknown>>>;
    if (!choices || choices.length === 0) return "";
    return choices[0].message?.content ?? "";
  }
}

// ---------------------------------------------------------------------------
// Tests: resolveBindings()
// ---------------------------------------------------------------------------

describe("resolveBindings()", () => {
  it("injects bound value from parentInputs", () => {
    const tool = makeTool("get_weather", [{ name: "unit", input: "temperatureUnit" }]);
    const agent = makeAgent({ tools: [tool] });

    const result = resolveBindings(
      agent,
      "get_weather",
      { city: "Paris" },
      { temperatureUnit: "celsius" },
    );
    expect(result).toEqual({ city: "Paris", unit: "celsius" });
  });

  it("does not overwrite LLM-provided value (defensive — shouldn't happen)", () => {
    const tool = makeTool("get_weather", [{ name: "unit", input: "temperatureUnit" }]);
    const agent = makeAgent({ tools: [tool] });

    const result = resolveBindings(
      agent,
      "get_weather",
      { city: "Paris", unit: "fahrenheit" },
      { temperatureUnit: "celsius" },
    );
    // Binding takes precedence (defensive override)
    expect(result).toEqual({ city: "Paris", unit: "celsius" });
  });

  it("passes through unchanged when no bindings", () => {
    const tool = makeTool("get_weather");
    const agent = makeAgent({ tools: [tool] });

    const result = resolveBindings(agent, "get_weather", { city: "Paris" }, {});
    expect(result).toEqual({ city: "Paris" });
  });

  it("skips missing parentInput gracefully", () => {
    const tool = makeTool("get_weather", [{ name: "unit", input: "temperatureUnit" }]);
    const agent = makeAgent({ tools: [tool] });

    const result = resolveBindings(
      agent,
      "get_weather",
      { city: "Paris" },
      {}, // no temperatureUnit
    );
    expect(result).toEqual({ city: "Paris" });
  });

  it("returns original args when tool not found in agent", () => {
    const agent = makeAgent({ tools: [] });
    const result = resolveBindings(agent, "unknown", { city: "Paris" }, { x: "y" });
    expect(result).toEqual({ city: "Paris" });
  });

  it("handles multiple bindings", () => {
    const tool = makeTool("get_weather", [
      { name: "unit", input: "temperatureUnit" },
      { name: "city", input: "defaultCity" },
    ]);
    const agent = makeAgent({ tools: [tool] });

    const result = resolveBindings(
      agent,
      "get_weather",
      {},
      { temperatureUnit: "celsius", defaultCity: "London" },
    );
    expect(result).toEqual({ unit: "celsius", city: "London" });
  });

  it("handles null agent tools", () => {
    const agent = makeAgent();
    agent.tools = undefined;
    const result = resolveBindings(agent, "get_weather", { city: "Paris" }, {});
    expect(result).toEqual({ city: "Paris" });
  });

  it("handles null parentInputs", () => {
    const tool = makeTool("get_weather", [{ name: "unit", input: "temperatureUnit" }]);
    const agent = makeAgent({ tools: [tool] });

    const result = resolveBindings(agent, "get_weather", { city: "Paris" });
    expect(result).toEqual({ city: "Paris" });
  });
});

// ---------------------------------------------------------------------------
// Tests: executeAgent() with bindings
// ---------------------------------------------------------------------------

describe("executeAgent() with bindings", () => {
  let callCount: number;
  let receivedArgs: Record<string, unknown> | null;

  beforeEach(() => {
    callCount = 0;
    receivedArgs = null;
    registerRenderer("mock", new MockRenderer());
    registerParser("mock", new MockParser());
    registerProcessor("mock", new MockProcessor());
  });

  it("injects bindings into tool args during agent loop", async () => {
    class BindingExecutor implements Executor {
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
                  function: { name: "get_weather", arguments: '{"city":"Paris"}' },
                }],
              },
            }],
          };
        }
        return {
          choices: [{ message: { role: "assistant", content: "Done!" } }],
        };
      }
    }

    registerExecutor("bindmock", new BindingExecutor());
    registerProcessor("bindmock", new MockProcessor());

    const tool = makeTool("get_weather", [{ name: "unit", input: "temperatureUnit" }]);
    const agent = makeAgent({
      instructions: "Hello {{name}}",
      tools: [tool],
    });
    agent.template = { format: { kind: "mock" }, parser: { kind: "mock" } } as any;
    (agent as any).model = { provider: "bindmock" };

    const tools = {
      get_weather: (args: Record<string, unknown>) => {
        receivedArgs = { ...args };
        return `72°F in ${args.city}`;
      },
    };

    const result = await executeAgent(
      agent,
      { name: "World", temperatureUnit: "celsius" },
      { tools: tools as any },
    );

    expect(result).toBe("Done!");
    expect(receivedArgs).toEqual({ city: "Paris", unit: "celsius" });
  });

  it("works without bindings (backward compatible)", async () => {
    class NoBindExecutor implements Executor {
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
                  function: { name: "greet", arguments: '{"who":"World"}' },
                }],
              },
            }],
          };
        }
        return {
          choices: [{ message: { role: "assistant", content: "Done!" } }],
        };
      }
    }

    registerExecutor("nobindmock", new NoBindExecutor());
    registerProcessor("nobindmock", new MockProcessor());

    const agent = makeAgent({ instructions: "Hello {{name}}" });
    agent.template = { format: { kind: "mock" }, parser: { kind: "mock" } } as any;
    (agent as any).model = { provider: "nobindmock" };

    const tools = {
      greet: (args: Record<string, unknown>) => {
        receivedArgs = { ...args };
        return `Hello ${args.who}!`;
      },
    };

    const result = await executeAgent(
      agent,
      { name: "Test" },
      { tools: tools as any },
    );

    expect(result).toBe("Done!");
    expect(receivedArgs).toEqual({ who: "World" });
  });
});

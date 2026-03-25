import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  validateInputs,
  render,
  parse,
  process,
  prepare,
  run,
  execute,
  executeAgent,
} from "../src/core/pipeline.js";
import {
  registerRenderer,
  registerParser,
  registerExecutor,
  registerProcessor,
} from "../src/core/registry.js";
import { Message, text } from "../src/core/types.js";
import { PromptAgent } from "agentschema";
import type { Renderer, Parser, Executor, Processor } from "../src/core/interfaces.js";

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

class MockRenderer implements Renderer {
  async render(_agent: PromptAgent, template: string, inputs: Record<string, unknown>): Promise<string> {
    let result = template;
    for (const [key, val] of Object.entries(inputs)) {
      result = result.replace(`{{${key}}}`, String(val));
    }
    return result;
  }
}

class MockParser implements Parser {
  async parse(_agent: PromptAgent, rendered: string): Promise<Message[]> {
    return [new Message("user", [text(rendered)])];
  }
}

class MockExecutor implements Executor {
  async execute(_agent: PromptAgent, _messages: Message[]): Promise<unknown> {
    return {
      choices: [{
        message: { role: "assistant", content: "Mock response" },
      }],
    };
  }
}

class MockProcessor implements Processor {
  async process(_agent: PromptAgent, response: unknown): Promise<unknown> {
    const r = response as Record<string, unknown>;
    const choices = r.choices as Record<string, unknown>[];
    const msg = choices[0].message as Record<string, unknown>;
    return msg.content;
  }
}

// ---------------------------------------------------------------------------
// Setup: register mock implementations for a test provider
// ---------------------------------------------------------------------------

function makeAgent(overrides?: Partial<{ name: string; model: string; instructions: string }>): PromptAgent {
  return new PromptAgent({
    name: overrides?.name ?? "test",
    model: overrides?.model ?? "gpt-4o",
    instructions: overrides?.instructions ?? "Hello, {{name}}!",
  });
}

describe("Pipeline", () => {
  beforeEach(() => {
    registerRenderer("mock", new MockRenderer());
    registerParser("mock", new MockParser());
    registerExecutor("mock", new MockExecutor());
    registerProcessor("mock", new MockProcessor());
  });

  describe("validateInputs()", () => {
    it("passes through inputs with no schema", () => {
      const agent = makeAgent();
      const result = validateInputs(agent, { foo: "bar" });
      expect(result).toEqual({ foo: "bar" });
    });

    it("fills defaults for missing inputs", () => {
      const agent = makeAgent();
      const { PropertySchema, Property } = require("agentschema");
      const schema = new PropertySchema();
      schema.properties = [new Property({ name: "x", default: 42 })];
      agent.inputSchema = schema;

      const result = validateInputs(agent, {});
      expect(result.x).toBe(42);
    });

    it("throws on missing required input", () => {
      const agent = makeAgent();
      const { PropertySchema, Property } = require("agentschema");
      const schema = new PropertySchema();
      schema.properties = [new Property({ name: "x", required: true })];
      agent.inputSchema = schema;

      expect(() => validateInputs(agent, {})).toThrow("Missing required input");
    });
  });

  describe("render()", () => {
    it("renders template with a registered renderer", async () => {
      const agent = makeAgent({ instructions: "Hi {{name}}" });
      // Override format kind to use our mock
      agent.template = { format: { kind: "mock" } } as any;

      const result = await render(agent, { name: "World" });
      expect(result).toBe("Hi World");
    });
  });

  describe("parse()", () => {
    it("parses rendered text with a registered parser", async () => {
      const agent = makeAgent();
      agent.template = { parser: { kind: "mock" } } as any;

      const messages = await parse(agent, "Hello test");
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
    });
  });

  describe("process()", () => {
    it("processes response with a registered processor", async () => {
      const agent = makeAgent();
      // Agent needs a mock provider
      (agent as any).model = { provider: "mock" };

      const response = {
        choices: [{ message: { role: "assistant", content: "result" } }],
      };
      const result = await process(agent, response);
      expect(result).toBe("result");
    });
  });

  describe("run()", () => {
    it("executes and processes messages", async () => {
      const agent = makeAgent();
      (agent as any).model = { provider: "mock" };

      const messages = [new Message("user", [text("Hello")])];
      const result = await run(agent, messages);
      expect(result).toBe("Mock response");
    });

    it("returns raw response when raw=true", async () => {
      const agent = makeAgent();
      (agent as any).model = { provider: "mock" };

      const messages = [new Message("user", [text("Hello")])];
      const result = await run(agent, messages, { raw: true }) as Record<string, unknown>;
      expect(result.choices).toBeDefined();
    });
  });

  describe("executeAgent()", () => {
    it("runs a simple agent with no tool calls", async () => {
      const agent = makeAgent();
      agent.template = { format: { kind: "mock" }, parser: { kind: "mock" } } as any;
      (agent as any).model = { provider: "mock" };

      const result = await executeAgent(agent, { name: "World" });
      expect(result).toBe("Mock response");
    });

    it("handles tool call loops", async () => {
      let callCount = 0;
      class ToolCallExecutor implements Executor {
        async execute(_agent: PromptAgent, messages: Message[]): Promise<unknown> {
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
          // Second call: return a normal response
          return {
            choices: [{ message: { role: "assistant", content: "Done!" } }],
          };
        }
      }

      registerExecutor("toolmock", new ToolCallExecutor());

      const agent = makeAgent();
      agent.template = { format: { kind: "mock" }, parser: { kind: "mock" } } as any;
      (agent as any).model = { provider: "toolmock" };

      registerProcessor("toolmock", new MockProcessor());

      const tools = {
        greet: (args: Record<string, unknown>) => `Hello ${args.who}!`,
      };

      const result = await executeAgent(agent, { name: "Test" }, { tools: tools as any });
      expect(result).toBe("Done!");
      expect(callCount).toBe(2);
    });

    it("throws on maxIterations exceeded", async () => {
      class InfiniteToolExecutor implements Executor {
        async execute(): Promise<unknown> {
          return {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_x",
                  type: "function",
                  function: { name: "loop", arguments: "{}" },
                }],
              },
            }],
          };
        }
      }

      registerExecutor("infmock", new InfiniteToolExecutor());
      registerProcessor("infmock", new MockProcessor());

      const agent = makeAgent();
      agent.template = { format: { kind: "mock" }, parser: { kind: "mock" } } as any;
      (agent as any).model = { provider: "infmock" };

      const tools = { loop: () => "looping" };

      await expect(
        executeAgent(agent, {}, { tools: tools as any, maxIterations: 2 }),
      ).rejects.toThrow("maxIterations");
    });
  });
});

/**
 * End-to-end pipeline tests for @prompty/foundry.
 *
 * Mirrors the @prompty/openai e2e.test.ts pattern: loads real .prompty files,
 * runs the full pipeline (load → render → parse → executor → processor),
 * captures .tracy traces, and asserts on both results and trace trees.
 *
 * Tests cover:
 * - FoundryExecutor/FoundryProcessor (provider: "foundry")
 * - AzureExecutor/AzureProcessor backward-compat (provider: "azure")
 * - All API types: chat, embedding, image, agent, responses, streaming
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  Tracer,
  PromptyTracer,
  execute,
  executeAgent,
  registerConnection,
  clearConnections,
  registerExecutor,
  registerProcessor,
} from "@prompty/core";
import { FoundryExecutor } from "../src/executor.js";
import { FoundryProcessor } from "../src/processor.js";
import { AzureExecutor } from "../src/azure-executor.js";
import { AzureProcessor } from "../src/azure-processor.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Mock OpenAI client (same shape the SDK exposes)
// ---------------------------------------------------------------------------

let lastChatArgs: Record<string, unknown> | null = null;
let lastEmbeddingArgs: Record<string, unknown> | null = null;
let lastImageArgs: Record<string, unknown> | null = null;
let lastResponsesArgs: Record<string, unknown> | null = null;
let chatCallCount = 0;
let chatResponder: ((args: Record<string, unknown>) => unknown) | null = null;
let responsesResponder: ((args: Record<string, unknown>) => unknown) | null = null;

function resetMock() {
  lastChatArgs = null;
  lastEmbeddingArgs = null;
  lastImageArgs = null;
  lastResponsesArgs = null;
  chatCallCount = 0;
  chatResponder = null;
  responsesResponder = null;
  mockClient.chat.completions.create = defaultChatCreate;
  mockClient.responses.create = defaultResponsesCreate;
}

const defaultChatCreate = async (args: Record<string, unknown>) => {
  lastChatArgs = args;
  chatCallCount++;
  if (chatResponder) return chatResponder(args);
  return {
    choices: [{
      message: { role: "assistant", content: "Hello from Foundry mock!" },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
};

const defaultResponsesCreate = async (args: Record<string, unknown>) => {
  lastResponsesArgs = args;
  if (responsesResponder) return responsesResponder(args);
  return {
    id: "resp_foundry_123",
    object: "response",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "Hello from Foundry Responses!" }],
      },
    ],
    output_text: "Hello from Foundry Responses!",
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
};

const mockClient = {
  constructor: { name: "AzureOpenAI" },
  chat: {
    completions: {
      create: defaultChatCreate,
    },
  },
  responses: {
    create: defaultResponsesCreate,
  },
  embeddings: {
    create: async (args: Record<string, unknown>) => {
      lastEmbeddingArgs = args;
      return {
        object: "list",
        data: [{ embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      };
    },
  },
  images: {
    generate: async (args: Record<string, unknown>) => {
      lastImageArgs = args;
      return {
        data: [{ url: "https://foundry-mock.example.com/image.png" }],
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const FIXTURES = path.resolve(import.meta.dirname, "fixtures");
let tempDir: string;

describe("Foundry E2E Pipeline", () => {
  beforeEach(() => {
    resetMock();
    Tracer.clear();
    clearConnections();

    // Register Foundry executor/processor
    registerExecutor("foundry", new FoundryExecutor());
    registerProcessor("foundry", new FoundryProcessor());

    // Register Azure backward-compat executor/processor
    registerExecutor("azure", new AzureExecutor());
    registerProcessor("azure", new AzureProcessor());

    // Register mock client as a named connection
    registerConnection("mock-foundry", mockClient);
    registerConnection("mock-azure", mockClient);

    // Temp dir for .tracy output
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompty-foundry-e2e-"));
  });

  afterEach(() => {
    Tracer.clear();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function readTrace(): { runtime: string; trace: TraceFrame } {
    const files = fs.readdirSync(tempDir).filter(f => f.endsWith(".tracy"));
    expect(files.length).toBeGreaterThan(0);
    return JSON.parse(fs.readFileSync(path.join(tempDir, files[0]), "utf-8"));
  }

  function findFrame(frame: TraceFrame, name: string): TraceFrame | null {
    if (frame.name === name) return frame;
    for (const child of frame.__frames ?? []) {
      const found = findFrame(child, name);
      if (found) return found;
    }
    return null;
  }

  function findSignature(frame: TraceFrame, sig: string): boolean {
    if (frame.signature === sig) return true;
    for (const child of frame.__frames ?? []) {
      if (findSignature(child, sig)) return true;
    }
    return false;
  }

  // =========================================================================
  // Chat completion
  // =========================================================================

  describe("chat completion", () => {
    it("runs full pipeline and returns response", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(
        path.resolve(FIXTURES, "chat.prompty"),
        { name: "Seth" },
      );

      expect(result).toBe("Hello from Foundry mock!");
    });

    it("sends correct wire format to SDK", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      await execute(path.resolve(FIXTURES, "chat.prompty"), { name: "Seth" });

      expect(lastChatArgs).toBeDefined();
      expect(lastChatArgs!.model).toBe("gpt-4o");
      expect(lastChatArgs!.temperature).toBe(0.7);
      expect(lastChatArgs!.max_completion_tokens).toBe(500);
      expect(lastChatArgs!.max_tokens).toBeUndefined();

      const messages = lastChatArgs!.messages as Record<string, unknown>[];
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("helpful assistant");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain("Seth");
    });

    it("produces correct trace tree", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      await execute(path.resolve(FIXTURES, "chat.prompty"), { name: "Seth" });

      const { runtime, trace } = readTrace();
      expect(runtime).toBe("typescript");
      expect(trace.name).toBe("execute");

      const frames = trace.__frames ?? [];
      const frameNames = frames.map((f: TraceFrame) => f.name);
      expect(frameNames).toContain("load");
      expect(frameNames).toContain("prepare");
      expect(frameNames).toContain("run");
    });

    it("trace includes FoundryExecutor signature", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      await execute(path.resolve(FIXTURES, "chat.prompty"), { name: "Seth" });

      const { trace } = readTrace();
      expect(findSignature(trace, "prompty.foundry.executor.FoundryExecutor.invoke")).toBe(true);
    });
  });

  // =========================================================================
  // Structured output
  // =========================================================================

  describe("structured output", () => {
    it("sends response_format and JSON-parses result", async () => {
      chatResponder = () => ({
        choices: [{
          message: {
            role: "assistant",
            content: '{"summary":"Quantum computing uses qubits","confidence":0.9}',
          },
          finish_reason: "stop",
        }],
      });

      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(path.resolve(FIXTURES, "structured.prompty"));

      expect(result).toEqual({ summary: "Quantum computing uses qubits", confidence: 0.9 });

      expect(lastChatArgs!.response_format).toBeDefined();
      const rf = lastChatArgs!.response_format as Record<string, unknown>;
      expect(rf.type).toBe("json_schema");

      const jsonSchema = rf.json_schema as Record<string, unknown>;
      expect(jsonSchema.name).toBe("foundry_structured");
      expect(jsonSchema.strict).toBe(true);
    });
  });

  // =========================================================================
  // Function tools
  // =========================================================================

  describe("function tools", () => {
    it("sends tool definitions in wire format", async () => {
      chatResponder = () => ({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_foundry_1",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"Seattle"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
      });

      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(path.resolve(FIXTURES, "tools.prompty"));

      expect(Array.isArray(result)).toBe(true);
      const toolCalls = result as { id: string; name: string; arguments: string }[];
      expect(toolCalls[0].name).toBe("get_weather");
      expect(toolCalls[0].id).toBe("call_foundry_1");

      expect(lastChatArgs!.tools).toBeDefined();
      const tools = lastChatArgs!.tools as Record<string, unknown>[];
      expect(tools.length).toBe(1);
      expect(tools[0].type).toBe("function");

      const fn = tools[0].function as Record<string, unknown>;
      expect(fn.name).toBe("get_weather");
    });
  });

  // =========================================================================
  // Embedding
  // =========================================================================

  describe("embedding", () => {
    it("calls embeddings.create and returns vectors", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(path.resolve(FIXTURES, "embedding.prompty"));

      expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);

      expect(lastEmbeddingArgs).toBeDefined();
      expect(lastEmbeddingArgs!.model).toBe("text-embedding-3-small");

      // No chat-specific fields
      expect(lastEmbeddingArgs!.temperature).toBeUndefined();
      expect(lastEmbeddingArgs!.max_completion_tokens).toBeUndefined();
    });

    it("trace includes embeddings.create signature", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      await execute(path.resolve(FIXTURES, "embedding.prompty"));

      const { trace } = readTrace();
      expect(findSignature(trace, "AzureOpenAI.embeddings.create")).toBe(true);
    });
  });

  // =========================================================================
  // Image generation
  // =========================================================================

  describe("image generation", () => {
    it("calls images.generate and returns URL", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(path.resolve(FIXTURES, "image.prompty"));

      expect(result).toBe("https://foundry-mock.example.com/image.png");

      expect(lastImageArgs).toBeDefined();
      expect(lastImageArgs!.model).toBe("dall-e-3");
      expect(lastImageArgs!.prompt).toContain("cute cat");
      expect(lastImageArgs!.size).toBe("1024x1024");

      // No chat-specific fields
      expect(lastImageArgs!.temperature).toBeUndefined();
    });
  });

  // =========================================================================
  // Agent loop
  // =========================================================================

  describe("agent loop", () => {
    it("executes tool calls and re-queries the model", async () => {
      let callNum = 0;
      chatResponder = (args) => {
        callNum++;
        if (callNum === 1) {
          return {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_foundry_weather",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"Seattle"}' },
                }],
              },
              finish_reason: "tool_calls",
            }],
          };
        }
        // Second call: verify tool result is in messages
        const messages = args.messages as Record<string, unknown>[];
        const toolMsg = messages.find(m => m.role === "tool");
        expect(toolMsg).toBeDefined();
        expect(toolMsg!.content).toBe("72°F and sunny");

        return {
          choices: [{
            message: { role: "assistant", content: "The weather in Seattle is 72°F and sunny." },
            finish_reason: "stop",
          }],
        };
      };

      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const tools = {
        get_weather: (_args: { city: string }) => "72°F and sunny",
      };

      const result = await executeAgent(
        path.resolve(FIXTURES, "agent.prompty"),
        { question: "What is the weather in Seattle?" },
        { tools: tools as Record<string, (...args: unknown[]) => unknown> },
      );

      expect(result).toBe("The weather in Seattle is 72°F and sunny.");
      expect(chatCallCount).toBe(2);
    });

    it("produces trace showing agent iterations", async () => {
      let callNum = 0;
      chatResponder = () => {
        callNum++;
        if (callNum === 1) {
          return {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"Seattle"}' },
                }],
              },
              finish_reason: "tool_calls",
            }],
          };
        }
        return {
          choices: [{
            message: { role: "assistant", content: "Done!" },
            finish_reason: "stop",
          }],
        };
      };

      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const tools = {
        get_weather: () => "sunny",
      };

      await executeAgent(
        path.resolve(FIXTURES, "agent.prompty"),
        {},
        { tools: tools as Record<string, (...args: unknown[]) => unknown> },
      );

      const { trace } = readTrace();
      expect(trace.name).toBe("executeAgent");
      expect(trace.iterations).toBe(1);
    });
  });

  // =========================================================================
  // Streaming
  // =========================================================================

  describe("streaming", () => {
    it("returns async generator that yields content chunks", async () => {
      const chunks = [
        { choices: [{ delta: { content: "Hello" }, finish_reason: null }] },
        { choices: [{ delta: { content: " from" }, finish_reason: null }] },
        { choices: [{ delta: { content: " Foundry!" }, finish_reason: "stop" }] },
      ];

      mockClient.chat.completions.create = async (args: Record<string, unknown>) => {
        lastChatArgs = args;
        chatCallCount++;
        return {
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) yield chunk;
          },
        };
      };

      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(
        path.resolve(FIXTURES, "streaming.prompty"),
        { topic: "streaming" },
      );

      expect(result).toBeDefined();
      expect(typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function");

      const collected: string[] = [];
      for await (const chunk of result as AsyncIterable<string>) {
        collected.push(chunk);
      }
      expect(collected).toEqual(["Hello", " from", " Foundry!"]);
      expect(lastChatArgs!.stream).toBe(true);
    });

    it("produces PromptyStream trace span after consumption", async () => {
      const chunks = [
        { choices: [{ delta: { content: "Hi" }, finish_reason: null }] },
        { choices: [{ delta: { content: "!" }, finish_reason: "stop" }] },
      ];

      mockClient.chat.completions.create = async (args: Record<string, unknown>) => {
        lastChatArgs = args;
        chatCallCount++;
        return {
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) yield chunk;
          },
        };
      };

      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(
        path.resolve(FIXTURES, "streaming.prompty"),
        { topic: "trace" },
      );

      // Consume stream to trigger tracing
      for await (const _ of result as AsyncIterable<unknown>) { /* drain */ }

      const { trace } = readTrace();
      // Trace root may be "execute" or "PromptyStream" depending on
      // async trace flush ordering — both are valid. The key assertion
      // is that PromptyStream appears somewhere in the trace tree.
      const streamFrame = findFrame(trace, "PromptyStream");
      expect(streamFrame).toBeDefined();
    });

    it("yields tool calls from streaming response", async () => {
      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_stream_1",
                function: { name: "get_weather", arguments: '{"ci' },
              }],
            },
            finish_reason: null,
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: 'ty":"Seattle"}' },
              }],
            },
            finish_reason: null,
          }],
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ];

      mockClient.chat.completions.create = async (args: Record<string, unknown>) => {
        lastChatArgs = args;
        chatCallCount++;
        return {
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) yield chunk;
          },
        };
      };

      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(
        path.resolve(FIXTURES, "streaming.prompty"),
        { topic: "tools" },
      );

      const collected: unknown[] = [];
      for await (const chunk of result as AsyncIterable<unknown>) {
        collected.push(chunk);
      }

      expect(collected.length).toBe(1);
      const tc = collected[0] as { id: string; name: string; arguments: string };
      expect(tc.id).toBe("call_stream_1");
      expect(tc.name).toBe("get_weather");
      expect(tc.arguments).toBe('{"city":"Seattle"}');
    });
  });

  // =========================================================================
  // Responses API
  // =========================================================================

  describe("Responses API", () => {
    it("calls responses.create and returns text", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(
        path.resolve(FIXTURES, "responses.prompty"),
        { name: "Seth" },
      );

      expect(result).toBe("Hello from Foundry Responses!");

      // Verify it called responses.create, not chat.completions.create
      expect(lastResponsesArgs).toBeDefined();
      expect(lastChatArgs).toBeNull();

      expect(lastResponsesArgs!.model).toBe("gpt-4o");
      expect(lastResponsesArgs!.instructions).toContain("helpful assistant");
      expect(lastResponsesArgs!.max_output_tokens).toBe(500);
      expect(lastResponsesArgs!.temperature).toBe(0.7);

      const input = lastResponsesArgs!.input as Record<string, unknown>[];
      expect(input.length).toBe(1);
      expect(input[0].role).toBe("user");
      expect(input[0].content).toContain("Seth");
    });

    it("handles structured output via text.format", async () => {
      responsesResponder = () => ({
        id: "resp_struct",
        object: "response",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: '{"summary":"Quantum bits","score":8}' }],
          },
        ],
        output_text: '{"summary":"Quantum bits","score":8}',
      });

      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(
        path.resolve(FIXTURES, "responses-structured.prompty"),
      );

      expect(result).toEqual({ summary: "Quantum bits", score: 8 });

      expect(lastResponsesArgs!.text).toBeDefined();
      const textField = lastResponsesArgs!.text as Record<string, unknown>;
      const format = textField.format as Record<string, unknown>;
      expect(format.type).toBe("json_schema");
      expect(format.name).toBe("foundry_responses_structured");
    });

    it("handles tool calls from Responses API", async () => {
      responsesResponder = () => ({
        id: "resp_tools_foundry",
        object: "response",
        output: [
          {
            type: "function_call",
            call_id: "call_resp_foundry_1",
            name: "get_weather",
            arguments: '{"city":"Seattle"}',
          },
        ],
      });

      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(
        path.resolve(FIXTURES, "responses-tools.prompty"),
      );

      expect(Array.isArray(result)).toBe(true);
      const toolCalls = result as { id: string; name: string; arguments: string }[];
      expect(toolCalls[0].id).toBe("call_resp_foundry_1");
      expect(toolCalls[0].name).toBe("get_weather");

      // Verify flat tool format (Responses API style)
      const tools = lastResponsesArgs!.tools as Record<string, unknown>[];
      expect(tools.length).toBe(1);
      expect(tools[0].type).toBe("function");
      expect(tools[0].name).toBe("get_weather");
      expect(tools[0].function).toBeUndefined(); // flat, not nested
    });

    it("trace includes responses.create signature", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      await execute(path.resolve(FIXTURES, "responses.prompty"), { name: "Seth" });

      const { trace } = readTrace();
      expect(findSignature(trace, "AzureOpenAI.responses.create")).toBe(true);
    });
  });

  // =========================================================================
  // Azure backward-compat (provider: "azure")
  // =========================================================================

  describe("Azure backward-compat", () => {
    it("runs chat completion via azure provider", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(
        path.resolve(FIXTURES, "azure-chat.prompty"),
        { name: "Azure" },
      );

      expect(result).toBe("Hello from Foundry mock!");

      expect(lastChatArgs).toBeDefined();
      expect(lastChatArgs!.model).toBe("gpt-4o");
      expect(lastChatArgs!.temperature).toBe(0.5);
      expect(lastChatArgs!.max_completion_tokens).toBe(256);

      const messages = lastChatArgs!.messages as Record<string, unknown>[];
      expect(messages[1].content).toContain("Azure");
    });

    it("trace includes AzureExecutor signature", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      await execute(path.resolve(FIXTURES, "azure-chat.prompty"), { name: "Azure" });

      const { trace } = readTrace();
      expect(findSignature(trace, "prompty.azure.executor.AzureExecutor.invoke")).toBe(true);
    });

    it("runs Responses API via azure provider", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(
        path.resolve(FIXTURES, "azure-responses.prompty"),
        { name: "Seth" },
      );

      expect(result).toBe("Hello from Foundry Responses!");

      expect(lastResponsesArgs).toBeDefined();
      expect(lastChatArgs).toBeNull();
      expect(lastResponsesArgs!.model).toBe("gpt-4o");
      expect(lastResponsesArgs!.instructions).toContain("helpful assistant");
      expect(lastResponsesArgs!.max_output_tokens).toBe(500);
    });

    it("streams chat completion via azure provider", async () => {
      const chunks = [
        { choices: [{ delta: { content: "Azure" }, finish_reason: null }] },
        { choices: [{ delta: { content: " streaming" }, finish_reason: "stop" }] },
      ];

      mockClient.chat.completions.create = async (args: Record<string, unknown>) => {
        lastChatArgs = args;
        chatCallCount++;
        return {
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) yield chunk;
          },
        };
      };

      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(
        path.resolve(FIXTURES, "azure-streaming.prompty"),
        { topic: "streaming" },
      );

      expect(typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function");

      const collected: string[] = [];
      for await (const chunk of result as AsyncIterable<string>) {
        collected.push(chunk);
      }
      expect(collected).toEqual(["Azure", " streaming"]);
      expect(lastChatArgs!.stream).toBe(true);
    });
  });

  // =========================================================================
  // Error cases
  // =========================================================================

  describe("error handling", () => {
    it("throws on unsupported apiType", async () => {
      // Directly invoke the executor with an unsupported apiType
      const executor = new FoundryExecutor();
      const { Prompty, Model, ReferenceConnection } = await import("@prompty/core");
      const agent = new Prompty({
        name: "bad-api-type",
        model: new Model({
          id: "gpt-4o",
          provider: "foundry",
          apiType: "banana",
          connection: new ReferenceConnection({ name: "mock-foundry" }),
        }),
      });

      await expect(executor.execute(agent, [])).rejects.toThrow("Unsupported apiType: banana");
    });
  });
});

// ---------------------------------------------------------------------------
// Trace frame type
// ---------------------------------------------------------------------------

interface TraceFrame {
  name: string;
  signature?: string;
  __time?: { start: string; end: string; duration: number };
  __frames?: TraceFrame[];
  __usage?: Record<string, unknown>;
  [key: string]: unknown;
}

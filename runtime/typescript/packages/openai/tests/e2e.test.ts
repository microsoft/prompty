/**
 * End-to-end pipeline tests with mocked OpenAI backend and PromptyTracer.
 *
 * Each test loads a real .prompty file, runs the full pipeline
 * (load → render → parse → executor → processor), captures the
 * .tracy trace file, and asserts on both the result and the trace tree.
 *
 * The OpenAI SDK client is mocked via ReferenceConnection so the
 * real OpenAIExecutor runs its wire-format logic against our fake.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  Tracer,
  PromptyTracer,
  execute,
  executeAgent,
  registerConnection,
  clearConnections,
} from "@prompty/core";
import { OpenAIExecutor } from "../src/executor.js";
import { OpenAIProcessor } from "../src/processor.js";
import { registerExecutor, registerProcessor } from "@prompty/core";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Mock OpenAI client
// ---------------------------------------------------------------------------

/** Captured args from the last SDK call, for assertions. */
let lastChatArgs: Record<string, unknown> | null = null;
let lastEmbeddingArgs: Record<string, unknown> | null = null;
let lastImageArgs: Record<string, unknown> | null = null;
let lastResponsesArgs: Record<string, unknown> | null = null;

/** How many times chat.completions.create was called (for agent loop). */
let chatCallCount = 0;

/** Override to return tool_calls on first call (for agent loop tests). */
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
  // Restore default create (streaming tests may replace it)
  mockOpenAIClient.chat.completions.create = defaultChatCreate;
  mockOpenAIClient.responses.create = defaultResponsesCreate;
}

const defaultChatCreate = async (args: Record<string, unknown>) => {
  lastChatArgs = args;
  chatCallCount++;
  if (chatResponder) return chatResponder(args);
  return {
    choices: [{
      message: { role: "assistant", content: "Hello from mock!" },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
};

const defaultResponsesCreate = async (args: Record<string, unknown>) => {
  lastResponsesArgs = args;
  if (responsesResponder) return responsesResponder(args);
  return {
    id: "resp_mock_123",
    object: "response",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "Hello from Responses API!" }],
      },
    ],
    output_text: "Hello from Responses API!",
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
};

const mockOpenAIClient = {
  constructor: { name: "OpenAI" },
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
        data: [{ url: "https://mock.example.com/image.png" }],
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const FIXTURES = path.resolve(import.meta.dirname, "fixtures");
let tempDir: string;

describe("E2E Pipeline", () => {
  beforeEach(() => {
    resetMock();
    Tracer.clear();
    clearConnections();

    // Register the real OpenAI executor/processor
    registerExecutor("openai", new OpenAIExecutor());
    registerProcessor("openai", new OpenAIProcessor());

    // Register mock client as a named connection
    registerConnection("mock-openai", mockOpenAIClient);

    // Set up PromptyTracer output dir
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompty-e2e-"));
  });

  afterEach(() => {
    Tracer.clear();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Read the trace from the .tracy file. */
  function readTrace(): { runtime: string; trace: TraceFrame } {
    const files = fs.readdirSync(tempDir).filter(f => f.endsWith(".tracy"));
    expect(files.length).toBeGreaterThan(0);
    return JSON.parse(fs.readFileSync(path.join(tempDir, files[0]), "utf-8"));
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

      expect(result).toBe("Hello from mock!");
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

      // Should have child frames: load, prepare (with render + parse), run (with executor + processor)
      const frames = trace.__frames ?? [];
      const frameNames = frames.map((f: TraceFrame) => f.name);
      expect(frameNames).toContain("load");
      expect(frameNames).toContain("prepare");
      expect(frameNames).toContain("run");
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

      // Result should be parsed JSON, not a string
      expect(result).toEqual({ summary: "Quantum computing uses qubits", confidence: 0.9 });

      // Wire format should include response_format
      expect(lastChatArgs!.response_format).toBeDefined();
      const rf = lastChatArgs!.response_format as Record<string, unknown>;
      expect(rf.type).toBe("json_schema");

      const jsonSchema = (rf.json_schema as Record<string, unknown>);
      expect(jsonSchema.name).toBe("e2e_structured");
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
              id: "call_123",
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

      // Processor should extract tool calls
      expect(Array.isArray(result)).toBe(true);
      const toolCalls = result as { id: string; name: string; arguments: string }[];
      expect(toolCalls[0].name).toBe("get_weather");
      expect(toolCalls[0].id).toBe("call_123");

      // Wire format should include tools
      expect(lastChatArgs!.tools).toBeDefined();
      const tools = lastChatArgs!.tools as Record<string, unknown>[];
      expect(tools.length).toBe(1);
      expect(tools[0].type).toBe("function");

      const fn = tools[0].function as Record<string, unknown>;
      expect(fn.name).toBe("get_weather");
      const params = fn.parameters as Record<string, unknown>;
      expect(params.type).toBe("object");
      expect((params.properties as Record<string, unknown>).city).toBeDefined();
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
      expect(Array.isArray(lastEmbeddingArgs!.input)).toBe(true);

      // Should NOT have chat-specific fields
      expect(lastEmbeddingArgs!.temperature).toBeUndefined();
      expect(lastEmbeddingArgs!.max_completion_tokens).toBeUndefined();
    });

    it("produces trace with embedding API call", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      await execute(path.resolve(FIXTURES, "embedding.prompty"));

      const { trace } = readTrace();
      // Find the executor frame
      const runFrame = trace.__frames?.find((f: TraceFrame) => f.name === "run");
      expect(runFrame).toBeDefined();
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

      expect(result).toBe("https://mock.example.com/image.png");

      expect(lastImageArgs).toBeDefined();
      expect(lastImageArgs!.model).toBe("dall-e-3");
      expect(lastImageArgs!.prompt).toContain("cute cat");
      expect(lastImageArgs!.size).toBe("1024x1024");

      // Should NOT have chat-specific fields
      expect(lastImageArgs!.temperature).toBeUndefined();
      expect(lastImageArgs!.max_completion_tokens).toBeUndefined();
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
          // First call: model requests a tool call
          return {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_weather_1",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"Seattle"}' },
                }],
              },
              finish_reason: "tool_calls",
            }],
          };
        }
        // Second call: model gives final answer (should see tool result in messages)
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
        get_weather: (args: { city: string }) => `72°F and sunny`,
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

      // Should record iterations
      expect(trace.iterations).toBe(1);
    });
  });

  // =========================================================================
  // Streaming
  // =========================================================================

  describe("streaming", () => {
    it("returns an async generator that yields content chunks", async () => {
      // Mock streaming response: an async iterable of chunk objects
      const chunks = [
        { choices: [{ delta: { content: "Hello" }, finish_reason: null }] },
        { choices: [{ delta: { content: " world" }, finish_reason: null }] },
        { choices: [{ delta: { content: "!" }, finish_reason: "stop" }] },
      ];

      mockOpenAIClient.chat.completions.create = async (args: Record<string, unknown>) => {
        lastChatArgs = args;
        chatCallCount++;
        // Return an async iterable (simulates SDK stream)
        return {
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) {
              yield chunk;
            }
          },
        };
      };

      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      const result = await execute(
        path.resolve(FIXTURES, "streaming.prompty"),
        { topic: "streaming" },
      );

      // Result should be an async generator
      expect(result).toBeDefined();
      expect(typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function");

      // Collect all chunks
      const collected: string[] = [];
      for await (const chunk of result as AsyncIterable<string>) {
        collected.push(chunk);
      }
      expect(collected).toEqual(["Hello", " world", "!"]);

      // Verify stream: true was sent to SDK
      expect(lastChatArgs!.stream).toBe(true);
    });

    it("yields tool calls from streaming response", async () => {
      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_abc",
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
                function: { arguments: 'ty":"NYC"}' },
              }],
            },
            finish_reason: null,
          }],
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ];

      mockOpenAIClient.chat.completions.create = async (args: Record<string, unknown>) => {
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

      // Should yield a ToolCall at the end
      expect(collected.length).toBe(1);
      const tc = collected[0] as { id: string; name: string; arguments: string };
      expect(tc.id).toBe("call_abc");
      expect(tc.name).toBe("get_weather");
      expect(tc.arguments).toBe('{"city":"NYC"}');
    });

    it("produces trace with PromptyStream span after consumption", async () => {
      const chunks = [
        { choices: [{ delta: { content: "Hi" }, finish_reason: null }] },
        { choices: [{ delta: { content: "!" }, finish_reason: "stop" }] },
      ];

      mockOpenAIClient.chat.completions.create = async (args: Record<string, unknown>) => {
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

      // Consume the stream to trigger tracing
      for await (const _ of result as AsyncIterable<unknown>) { /* drain */ }

      const { trace } = readTrace();

      // Find a named trace frame anywhere in the tree
      function findFrame(frame: TraceFrame, name: string): TraceFrame | null {
        if (frame.name === name) return frame;
        for (const child of frame.__frames ?? []) {
          const found = findFrame(child, name);
          if (found) return found;
        }
        return null;
      }

      // Both execute and PromptyStream should appear somewhere in the trace tree
      const executeFrame = findFrame(trace, "execute");
      expect(executeFrame).toBeDefined();

      const streamFrame = findFrame(trace, "PromptyStream");
      expect(streamFrame).toBeDefined();
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

      expect(result).toBe("Hello from Responses API!");

      // Verify it called responses.create, not chat.completions.create
      expect(lastResponsesArgs).toBeDefined();
      expect(lastChatArgs).toBeNull();

      // Check wire format
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

      // Verify text.format was sent
      expect(lastResponsesArgs!.text).toBeDefined();
      const text = lastResponsesArgs!.text as Record<string, unknown>;
      const format = text.format as Record<string, unknown>;
      expect(format.type).toBe("json_schema");
      expect(format.name).toBe("e2e_responses_structured");
    });

    it("handles tool calls from Responses API", async () => {
      responsesResponder = () => ({
        id: "resp_tools",
        object: "response",
        output: [
          {
            type: "function_call",
            call_id: "call_resp_1",
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
      expect(toolCalls[0].id).toBe("call_resp_1");
      expect(toolCalls[0].name).toBe("get_weather");

      // Verify flat tool format
      const tools = lastResponsesArgs!.tools as Record<string, unknown>[];
      expect(tools.length).toBe(1);
      expect(tools[0].type).toBe("function");
      expect(tools[0].name).toBe("get_weather");
      expect(tools[0].function).toBeUndefined(); // flat, not nested
    });

    it("produces correct trace tree", async () => {
      const pt = new PromptyTracer({ outputDir: tempDir });
      Tracer.add("test", pt.factory);

      await execute(path.resolve(FIXTURES, "responses.prompty"), { name: "Seth" });

      const { trace } = readTrace();
      expect(trace.name).toBe("execute");

      // Find the executor span — should reference responses.create
      function findSignature(frame: TraceFrame): string | null {
        if (frame.signature === "OpenAI.responses.create") return frame.signature as string;
        for (const child of frame.__frames ?? []) {
          const found = findSignature(child);
          if (found) return found;
        }
        return null;
      }

      const sig = findSignature(trace);
      expect(sig).toBe("OpenAI.responses.create");
    });
  });
});

// ---------------------------------------------------------------------------
// Trace frame type for assertions
// ---------------------------------------------------------------------------

interface TraceFrame {
  name: string;
  __time?: { start: string; end: string; duration: number };
  __frames?: TraceFrame[];
  __usage?: Record<string, unknown>;
  [key: string]: unknown;
}

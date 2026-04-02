/**
 * End-to-end pipeline tests with mocked Anthropic backend and PromptyTracer.
 *
 * Each test loads a real .prompty file, runs the full pipeline
 * (load → render → parse → executor → processor), captures the
 * .tracy trace file, and asserts on both the result and the trace tree.
 *
 * The Anthropic SDK client is mocked via ReferenceConnection so the
 * real AnthropicExecutor runs its wire-format logic against our fake.
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
import { AnthropicExecutor } from "../src/executor.js";
import { AnthropicProcessor, processResponse } from "../src/processor.js";
import { buildChatArgs, messageToWire, toolsToWire, outputSchemaToWire } from "../src/wire.js";
import { registerExecutor, registerProcessor } from "@prompty/core";
import { Message } from "@prompty/core";
import type { TextPart } from "@prompty/core";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/** Helper: create a Message with a single text part. */
function textMsg(role: "system" | "user" | "assistant" | "tool", text: string, metadata: Record<string, unknown> = {}): Message {
  return new Message(role, [{ kind: "text", value: text } as TextPart], metadata);
}

// ---------------------------------------------------------------------------
// Mock Anthropic client
// ---------------------------------------------------------------------------

let lastCreateArgs: Record<string, unknown> | null = null;
let createCallCount = 0;
let createResponder: ((args: Record<string, unknown>) => unknown) | null = null;

function resetMock() {
  lastCreateArgs = null;
  createCallCount = 0;
  createResponder = null;
  mockAnthropicClient.messages.create = defaultCreate;
}

const defaultCreate = async (args: Record<string, unknown>) => {
  lastCreateArgs = args;
  createCallCount++;
  if (createResponder) return createResponder(args);
  return {
    id: "msg_mock_123",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello from mock Anthropic!" }],
    model: "claude-sonnet-4-5-20250929",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
};

const mockAnthropicClient = {
  messages: {
    create: defaultCreate,
    stream: () => {
      throw new Error("stream not mocked in this test");
    },
  },
  // Make it look like an Anthropic client
  constructor: { name: "Anthropic" },
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES = path.resolve(import.meta.dirname, "fixtures");

function fixtureFile(name: string): string {
  return path.resolve(FIXTURES, name);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tracyDir: string;

beforeEach(() => {
  resetMock();

  // Register mock client
  registerConnection("mock-anthropic", mockAnthropicClient);

  // Register our executor & processor
  registerExecutor("anthropic", new AnthropicExecutor());
  registerProcessor("anthropic", new AnthropicProcessor());

  // Tracer → temp dir
  tracyDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompty-anthropic-test-"));
  Tracer.clear();
  const pt = new PromptyTracer({ outputDir: tracyDir });
  Tracer.add("test-tracer", pt.factory);
});

afterEach(() => {
  Tracer.clear();
  clearConnections();
  fs.rmSync(tracyDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Wire format tests
// ---------------------------------------------------------------------------

describe("wire format", () => {
  it("separates system messages from conversation", () => {
    const msgs = [
      textMsg("system", "You are helpful."),
      textMsg("user", "Hello"),
    ];

    // buildChatArgs needs a Prompty-like agent
    const mockAgent = {
      model: { id: "claude-sonnet-4-5-20250929", options: { maxOutputTokens: 512 } },
      tools: [],
      outputs: [],
    };
    const args = buildChatArgs(mockAgent as any, msgs);

    expect(args.system).toBe("You are helpful.");
    expect(args.messages).toEqual([{ role: "user", content: "Hello" }]);
    expect(args.max_tokens).toBe(512);
  });

  it("defaults max_tokens to 1024", () => {
    const msgs = [textMsg("user", "Hi")];
    const args = buildChatArgs({ model: { id: "claude-sonnet-4-5-20250929" } } as any, msgs);
    expect(args.max_tokens).toBe(1024);
  });

  it("maps model options correctly", () => {
    const msgs = [textMsg("user", "Hi")];
    const args = buildChatArgs(
      {
        model: {
          id: "claude-haiku-4-5-20250929",
          options: {
            temperature: 0.5,
            topP: 0.9,
            topK: 40,
            maxOutputTokens: 2000,
            stopSequences: ["END"],
          },
        },
      } as any,
      msgs,
    );

    expect(args.temperature).toBe(0.5);
    expect(args.top_p).toBe(0.9);
    expect(args.top_k).toBe(40);
    expect(args.max_tokens).toBe(2000);
    expect(args.stop_sequences).toEqual(["END"]);
  });

  it("converts tools to Anthropic format (input_schema, no wrapper)", () => {
    const mockAgent = {
      tools: [
        {
          name: "get_weather",
          kind: "function",
          description: "Get weather",
          parameters: [
            { name: "city", kind: "string", description: "City", required: true },
          ],
        },
      ],
    };
    const tools = toolsToWire(mockAgent as any);

    expect(tools).toEqual([
      {
        name: "get_weather",
        description: "Get weather",
        input_schema: {
          type: "object",
          properties: { city: { type: "string", description: "City" } },
          required: ["city"],
        },
      },
    ]);
  });

  it("skips non-function tools", () => {
    const mockAgent = {
      tools: [
        { name: "mcp_tool", kind: "mcp", description: "MCP tool" },
        { name: "fn_tool", kind: "function", description: "Function tool", parameters: [] },
      ],
    };
    const tools = toolsToWire(mockAgent as any);
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("fn_tool");
  });

  it("converts outputSchema to Anthropic output_config format", () => {
    const mockAgent = {
      name: "test-agent",
      outputs: [
        { name: "title", kind: "string", description: "Title" },
        { name: "score", kind: "float", description: "Score" },
      ],
    };
    const config = outputSchemaToWire(mockAgent as any);

    expect(config).toEqual({
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Title" },
            score: { type: "number", description: "Score" },
          },
          required: ["title", "score"],
          additionalProperties: false,
        },
      },
    });
  });

  it("returns null for empty outputSchema", () => {
    expect(outputSchemaToWire({ outputs: [] } as any)).toBeNull();
    expect(outputSchemaToWire({ outputs: undefined } as any)).toBeNull();
  });

  it("converts tool result messages", () => {
    const msg = textMsg("tool", "72°F and sunny", {
      tool_use_id: "toolu_123",
    });
    const wire = messageToWire(msg);

    expect(wire.role).toBe("user");
    expect(wire.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "toolu_123",
        content: "72°F and sunny",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Processor tests
// ---------------------------------------------------------------------------

describe("processor", () => {
  it("extracts text from content blocks", () => {
    const response = {
      role: "assistant",
      content: [{ type: "text", text: "Hello world" }],
      stop_reason: "end_turn",
    };
    const result = processResponse({} as any, response);
    expect(result).toBe("Hello world");
  });

  it("concatenates multiple text blocks", () => {
    const response = {
      role: "assistant",
      content: [
        { type: "text", text: "Part 1 " },
        { type: "text", text: "Part 2" },
      ],
      stop_reason: "end_turn",
    };
    const result = processResponse({} as any, response);
    expect(result).toBe("Part 1 Part 2");
  });

  it("extracts tool_use blocks as ToolCall[]", () => {
    const response = {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_123",
          name: "get_weather",
          input: { city: "Seattle" },
        },
      ],
      stop_reason: "tool_use",
    };
    const result = processResponse({} as any, response) as any[];
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("toolu_123");
    expect(result[0].name).toBe("get_weather");
    expect(JSON.parse(result[0].arguments)).toEqual({ city: "Seattle" });
  });

  it("handles mixed text + tool_use blocks (tool_use wins)", () => {
    const response = {
      role: "assistant",
      content: [
        { type: "text", text: "Let me check..." },
        {
          type: "tool_use",
          id: "toolu_456",
          name: "search",
          input: { query: "test" },
        },
      ],
      stop_reason: "tool_use",
    };
    const result = processResponse({} as any, response) as any[];
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("search");
  });

  it("JSON-parses text when outputSchema present", () => {
    const agent = { outputs: [{ name: "title", kind: "string" }] };
    const response = {
      role: "assistant",
      content: [{ type: "text", text: '{"title": "Test"}' }],
      stop_reason: "end_turn",
    };
    const result = processResponse(agent as any, response);
    expect(result).toEqual({ title: "Test" });
  });

  it("returns raw text if JSON parse fails with outputSchema", () => {
    const agent = { outputs: [{ name: "x", kind: "string" }] };
    const response = {
      role: "assistant",
      content: [{ type: "text", text: "not json" }],
      stop_reason: "end_turn",
    };
    const result = processResponse(agent as any, response);
    expect(result).toBe("not json");
  });

  it("returns null for empty content", () => {
    const response = { role: "assistant", content: [], stop_reason: "end_turn" };
    const result = processResponse({} as any, response);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Streaming processor tests
// ---------------------------------------------------------------------------

describe("streaming processor", () => {
  it("yields text deltas from content_block_delta events", async () => {
    const events = [
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      { type: "message_stop" },
    ];

    async function* mockStream() {
      for (const e of events) yield e;
    }

    const result = processResponse({} as any, mockStream());
    const chunks: unknown[] = [];
    for await (const chunk of result as AsyncIterable<unknown>) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["Hello", " world"]);
  });

  it("accumulates tool call from streaming events", async () => {
    const events = [
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_stream", name: "get_weather" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"city":' },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"Seattle"}' },
      },
      { type: "message_stop" },
    ];

    async function* mockStream() {
      for (const e of events) yield e;
    }

    const result = processResponse({} as any, mockStream());
    const chunks: unknown[] = [];
    for await (const chunk of result as AsyncIterable<unknown>) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    const tc = chunks[0] as { id: string; name: string; arguments: string };
    expect(tc.id).toBe("toolu_stream");
    expect(tc.name).toBe("get_weather");
    expect(JSON.parse(tc.arguments)).toEqual({ city: "Seattle" });
  });
});

// ---------------------------------------------------------------------------
// E2E pipeline tests
// ---------------------------------------------------------------------------

describe("e2e pipeline", () => {
  it("chat: full pipeline produces string result", async () => {
    const result = await execute(fixtureFile("chat.prompty"), {
      question: "Hello",
    });
    expect(typeof result).toBe("string");
    expect(result).toBe("Hello from mock Anthropic!");

    // Verify wire format sent to mock
    expect(lastCreateArgs).not.toBeNull();
    expect(lastCreateArgs!.model).toBe("claude-sonnet-4-5-20250929");
    expect(lastCreateArgs!.system).toBeDefined();
    expect(Array.isArray(lastCreateArgs!.messages)).toBe(true);
    expect(lastCreateArgs!.max_tokens).toBeDefined();
  });

  it("tools: includes tools in wire format", async () => {
    const result = await execute(fixtureFile("tools.prompty"), {
      question: "What is the weather?",
    });
    expect(result).toBe("Hello from mock Anthropic!");

    // Verify tools were sent
    expect(lastCreateArgs!.tools).toBeDefined();
    const tools = lastCreateArgs!.tools as Record<string, unknown>[];
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("get_weather");
    expect(tools[0].input_schema).toBeDefined();
    // No {type: "function", function: {...}} wrapper
    expect(tools[0].type).toBeUndefined();
  });

  it("structured: includes output_config in wire format", async () => {
    createResponder = () => ({
      id: "msg_struct",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "text",
          text: '{"title":"Quantum Computing","summary":"A summary","confidence":0.95}',
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 20, output_tokens: 15 },
    });

    const result = await execute(fixtureFile("structured.prompty"), {
      topic: "quantum computing",
    });

    // Should be JSON-parsed
    expect(result).toEqual({
      title: "Quantum Computing",
      summary: "A summary",
      confidence: 0.95,
    });

    // Verify output_config was sent
    expect(lastCreateArgs!.output_config).toBeDefined();
  });

  it("agent loop: executeAgent handles tool calls", async () => {
    let callNum = 0;
    createResponder = () => {
      callNum++;
      if (callNum === 1) {
        // First call: return tool_use
        return {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_abc",
              name: "get_weather",
              input: { city: "Seattle" },
            },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 15, output_tokens: 20 },
        };
      }
      // Second call: return final text
      return {
        id: "msg_2",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "It's 72°F in Seattle." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 25, output_tokens: 10 },
      };
    };

    function getWeather(args: { city: string }) {
      return `72°F and sunny in ${args.city}`;
    }

    const result = await executeAgent(
      fixtureFile("agent.prompty"),
      { question: "What is the weather in Seattle?" },
      { tools: { get_weather: getWeather } },
    );

    expect(createCallCount).toBe(2);
    expect(typeof result).toBe("string");
    expect(result).toBe("It's 72°F in Seattle.");
  });

  it("produces .tracy trace file", async () => {
    await execute(fixtureFile("chat.prompty"), { question: "Trace test" });

    const tracyFiles = fs.readdirSync(tracyDir).filter((f) => f.endsWith(".tracy"));
    expect(tracyFiles.length).toBeGreaterThan(0);
  });
});

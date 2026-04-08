/**
 * Tests for chat-basic.ts — mock the OpenAI client, verify the example works.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
  load,
  prepare,
  run,
  invoke,
  registerExecutor,
  registerProcessor,
  Message,
  text,
} from "@prompty/core";
import type { Executor, Processor, Prompty } from "@prompty/core";
import { resolve } from "node:path";

const PROMPTS_DIR = resolve(import.meta.dirname, "../../prompts");

// Set dummy env vars so ${env:...} references resolve during loading
beforeAll(() => {
  process.env.OPENAI_API_KEY ??= "test-key-for-loading";
});

// ---------------------------------------------------------------------------
// Mock executor & processor — no real API calls
// ---------------------------------------------------------------------------

class MockOpenAIExecutor implements Executor {
  lastMessages: Message[] = [];
  mockResponse: unknown = {
    choices: [{ message: { role: "assistant", content: "Mock chat response" } }],
  };

  async execute(_agent: Prompty, messages: Message[]): Promise<unknown> {
    this.lastMessages = messages;
    return this.mockResponse;
  }

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
      new Message("assistant", textContent ? [text(textContent)] : [], {
        tool_calls: rawToolCalls,
      }),
    );
    for (let i = 0; i < toolCalls.length; i++) {
      messages.push(
        new Message("tool", [text(toolResults[i])], {
          tool_call_id: toolCalls[i].id,
          name: toolCalls[i].name,
        }),
      );
    }
    return messages;
  }
}

class MockOpenAIProcessor implements Processor {
  async process(agent: Prompty, response: unknown): Promise<unknown> {
    const r = response as Record<string, unknown>;

    // ChatCompletion
    if (r.choices) {
      const choices = r.choices as Record<string, unknown>[];
      const message = choices[0].message as Record<string, unknown>;

      // Tool calls
      if (message.tool_calls) return message.tool_calls;

      const content = message.content as string;

      // Structured output
      if (agent.outputs && agent.outputs.length > 0) {
        try { return JSON.parse(content); } catch { return content; }
      }
      return content;
    }

    // Embedding
    if (r.data && r.object === "list") {
      const data = r.data as Record<string, unknown>[];
      return data.length === 1
        ? (data[0] as Record<string, unknown>).embedding
        : data.map((d) => (d as Record<string, unknown>).embedding);
    }

    // Image
    if (r.data && Array.isArray(r.data)) {
      const data = r.data as Record<string, unknown>[];
      return data.length === 1 ? data[0].url : data.map((d) => d.url);
    }

    return response;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chat-basic", () => {
  let mockExecutor: MockOpenAIExecutor;
  let mockProcessor: MockOpenAIProcessor;

  beforeEach(() => {
    mockExecutor = new MockOpenAIExecutor();
    mockProcessor = new MockOpenAIProcessor();
    registerExecutor("openai", mockExecutor);
    registerProcessor("openai", mockProcessor);
  });

  it("loads chat-basic.prompty", () => {
    const agent = load(resolve(PROMPTS_DIR, "chat-basic.prompty"));
    expect(agent.name).toBe("openai-chat");
    expect(agent.model.id).toBe("gpt-4o-mini");
    expect(agent.model.provider).toBe("openai");
    expect(agent.model.apiType).toBe("chat");
  });

  it("prepares messages with system and user roles", async () => {
    const agent = load(resolve(PROMPTS_DIR, "chat-basic.prompty"));
    const messages = await prepare(agent, { question: "Hello!" });

    const roles = messages.map((m) => m.role);
    expect(roles).toContain("system");
    expect(roles).toContain("user");

    const userMsg = messages.find((m) => m.role === "user");
    expect(userMsg?.text).toContain("Hello!");
  });

  it("fills default input values", async () => {
    const agent = load(resolve(PROMPTS_DIR, "chat-basic.prompty"));
    const messages = await prepare(agent); // no inputs — should use defaults

    const userMsg = messages.find((m) => m.role === "user");
    expect(userMsg?.text).toContain("What is Prompty?");
  });

  it("invokes end-to-end and returns mock response", async () => {
    const result = await invoke(
      resolve(PROMPTS_DIR, "chat-basic.prompty"),
      { question: "What is TypeScript?" },
    );
    expect(result).toBe("Mock chat response");
  });

  it("passes messages to executor", async () => {
    await invoke(
      resolve(PROMPTS_DIR, "chat-basic.prompty"),
      { question: "Test question" },
    );

    expect(mockExecutor.lastMessages.length).toBeGreaterThan(0);
    const userMsg = mockExecutor.lastMessages.find((m) => m.role === "user");
    expect(userMsg?.text).toContain("Test question");
  });

  it("invoke with run() works the same as invoke()", async () => {
    const agent = load(resolve(PROMPTS_DIR, "chat-basic.prompty"));
    const messages = await prepare(agent, { question: "Test" });
    const result = await run(agent, messages);
    expect(result).toBe("Mock chat response");
  });
});

describe("chat-pipeline stages", () => {
  let mockExecutor: MockOpenAIExecutor;
  let mockProcessor: MockOpenAIProcessor;

  beforeEach(() => {
    mockExecutor = new MockOpenAIExecutor();
    mockProcessor = new MockOpenAIProcessor();
    registerExecutor("openai", mockExecutor);
    registerProcessor("openai", mockProcessor);
  });

  it("load returns a Prompty with all expected fields", () => {
    const agent = load(resolve(PROMPTS_DIR, "chat-basic.prompty"));

    expect(agent.name).toBeTruthy();
    expect(agent.model).toBeDefined();
    expect(agent.model.id).toBeTruthy();
    expect(agent.instructions).toBeTruthy();
    expect(agent.inputs).toBeDefined();
  });

  it("prepare returns an array of Message instances", async () => {
    const agent = load(resolve(PROMPTS_DIR, "chat-basic.prompty"));
    const messages = await prepare(agent, { question: "Hello" });

    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
    for (const msg of messages) {
      expect(msg).toBeInstanceOf(Message);
      expect(["system", "user", "assistant", "developer", "tool"]).toContain(msg.role);
    }
  });

  it("run returns processed result", async () => {
    const agent = load(resolve(PROMPTS_DIR, "chat-basic.prompty"));
    const messages = await prepare(agent, { question: "Hello" });
    const result = await run(agent, messages);
    expect(typeof result).toBe("string");
  });
});

describe("structured output", () => {
  let mockExecutor: MockOpenAIExecutor;
  let mockProcessor: MockOpenAIProcessor;

  beforeEach(() => {
    mockExecutor = new MockOpenAIExecutor();
    mockProcessor = new MockOpenAIProcessor();
    registerExecutor("openai", mockExecutor);
    registerProcessor("openai", mockProcessor);
  });

  it("loads structured-output.prompty with output schema", () => {
    const agent = load(resolve(PROMPTS_DIR, "structured-output.prompty"));
    expect(agent.outputs).toBeDefined();
    expect(agent.outputs!.length).toBeGreaterThan(0);
  });

  it("returns parsed JSON when outputs are defined", async () => {
    mockExecutor.mockResponse = {
      choices: [{
        message: {
          role: "assistant",
          content: '{"city":"Seattle","temperature":55,"conditions":"cloudy"}',
        },
      }],
    };

    const result = await invoke(
      resolve(PROMPTS_DIR, "structured-output.prompty"),
      { city: "Seattle" },
    );

    expect(result).toEqual({
      city: "Seattle",
      temperature: 55,
      conditions: "cloudy",
    });
  });
});

describe("embedding", () => {
  let mockExecutor: MockOpenAIExecutor;
  let mockProcessor: MockOpenAIProcessor;

  beforeEach(() => {
    mockExecutor = new MockOpenAIExecutor();
    mockProcessor = new MockOpenAIProcessor();
    registerExecutor("openai", mockExecutor);
    registerProcessor("openai", mockProcessor);
  });

  it("loads embedding.prompty", () => {
    const agent = load(resolve(PROMPTS_DIR, "embedding.prompty"));
    expect(agent.model.apiType).toBe("embedding");
    expect(agent.model.id).toBe("text-embedding-3-small");
  });

  it("returns embedding vector from mock", async () => {
    const mockEmbedding = Array.from({ length: 10 }, (_, i) => i * 0.1);
    mockExecutor.mockResponse = {
      object: "list",
      data: [{ embedding: mockEmbedding }],
    };

    const result = await invoke(
      resolve(PROMPTS_DIR, "embedding.prompty"),
      { text: "Hello world" },
    );
    expect(result).toEqual(mockEmbedding);
  });
});

describe("image generation", () => {
  let mockExecutor: MockOpenAIExecutor;
  let mockProcessor: MockOpenAIProcessor;

  beforeEach(() => {
    mockExecutor = new MockOpenAIExecutor();
    mockProcessor = new MockOpenAIProcessor();
    registerExecutor("openai", mockExecutor);
    registerProcessor("openai", mockProcessor);
  });

  it("loads image-gen.prompty", () => {
    const agent = load(resolve(PROMPTS_DIR, "image-gen.prompty"));
    expect(agent.model.apiType).toBe("image");
    expect(agent.model.id).toBe("dall-e-3");
  });

  it("returns image URL from mock", async () => {
    mockExecutor.mockResponse = {
      data: [{ url: "https://example.com/image.png" }],
    };

    const result = await invoke(
      resolve(PROMPTS_DIR, "image-gen.prompty"),
      { prompt: "A sunset" },
    );
    expect(result).toBe("https://example.com/image.png");
  });
});

describe("streaming", () => {
  let mockExecutor: MockOpenAIExecutor;
  let mockProcessor: MockOpenAIProcessor;

  beforeEach(() => {
    mockExecutor = new MockOpenAIExecutor();
    mockProcessor = new MockOpenAIProcessor();
    registerExecutor("openai", mockExecutor);
    registerProcessor("openai", mockProcessor);
  });

  it("loads streaming-chat.prompty", () => {
    const agent = load(resolve(PROMPTS_DIR, "streaming-chat.prompty"));
    expect(agent.name).toBe("streaming-chat");
    expect(agent.model.apiType).toBe("chat");
  });

  it("prepares messages correctly", async () => {
    const agent = load(resolve(PROMPTS_DIR, "streaming-chat.prompty"));
    const messages = await prepare(agent, { question: "Tell me a joke" });

    const systemMsg = messages.find((m) => m.role === "system");
    expect(systemMsg?.text).toContain("creative storyteller");

    const userMsg = messages.find((m) => m.role === "user");
    expect(userMsg?.text).toContain("Tell me a joke");
  });
});

describe("agent tool calling", () => {
  let mockExecutor: MockOpenAIExecutor;
  let mockProcessor: MockOpenAIProcessor;

  beforeEach(() => {
    mockExecutor = new MockOpenAIExecutor();
    mockProcessor = new MockOpenAIProcessor();
    registerExecutor("openai", mockExecutor);
    registerProcessor("openai", mockProcessor);
  });

  it("loads chat-agent.prompty with tools", () => {
    const agent = load(resolve(PROMPTS_DIR, "chat-agent.prompty"));
    expect(agent.name).toBe("openai-agent");
    expect(agent.tools).toBeDefined();
    expect(agent.tools!.length).toBeGreaterThan(0);
    expect(agent.tools![0].name).toBe("get_weather");
  });

  it("prepares messages for agent prompt", async () => {
    const agent = load(resolve(PROMPTS_DIR, "chat-agent.prompty"));
    const messages = await prepare(agent, { question: "Weather in NYC?" });

    const systemMsg = messages.find((m) => m.role === "system");
    expect(systemMsg?.text).toContain("tools");

    const userMsg = messages.find((m) => m.role === "user");
    expect(userMsg?.text).toContain("Weather in NYC?");
  });
});

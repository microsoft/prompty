/**
 * OpenAI integration tests — real API calls against OpenAI endpoints.
 * Auto-skipped when OPENAI_API_KEY is not set.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  Tracer,
  execute,
  executeAgent,
  registerConnection,
  clearConnections,
  registerExecutor,
  registerProcessor,
  Prompty,
} from "@prompty/core";
import { OpenAIExecutor } from "../src/executor.js";
import { OpenAIProcessor } from "../src/processor.js";

// ---------------------------------------------------------------------------
// Env loading (zero-dep — reads workspace-root .env)
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = resolve(__dirname, "../../../.env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}
loadEnv();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL;
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL;
const hasOpenAI = !!OPENAI_API_KEY;

const DIRECT_OPENAI_API_KEY = process.env.DIRECT_OPENAI_API_KEY;
const DIRECT_OPENAI_MODEL = process.env.DIRECT_OPENAI_MODEL || "gpt-4o-mini";
const hasDirectOpenAI = !!DIRECT_OPENAI_API_KEY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAgent(opts: {
  apiType?: string;
  instructions?: string;
  model?: string;
  options?: Record<string, unknown>;
  tools?: Record<string, unknown>[];
  outputs?: Record<string, unknown>[];
  inputs?: Record<string, unknown>[];
} = {}): Prompty {
  return Prompty.load({
    name: "openai-integration",
    model: {
      id: opts.model || OPENAI_MODEL,
      provider: "openai",
      apiType: opts.apiType || "chat",
      connection: { kind: "reference", name: "test-openai" },
      options: { temperature: 0, maxOutputTokens: 200, ...(opts.options || {}) },
    },
    template: { format: { kind: "jinja2" }, parser: { kind: "prompty" } },
    instructions:
      opts.instructions ??
      "system:\nYou are a helpful assistant. Be very brief.\nuser:\n{{question}}",
    inputs: opts.inputs ?? [
      { name: "question", kind: "string", default: "Say hello in exactly 3 words." },
    ],
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(opts.outputs ? { outputs: opts.outputs } : {}),
  });
}

function makeDirectAgent(opts: {
  apiType?: string;
  instructions?: string;
  model?: string;
  options?: Record<string, unknown>;
  tools?: Record<string, unknown>[];
  outputs?: Record<string, unknown>[];
  inputs?: Record<string, unknown>[];
} = {}): Prompty {
  return Prompty.load({
    name: "direct-openai-integration",
    model: {
      id: opts.model || DIRECT_OPENAI_MODEL,
      provider: "openai",
      apiType: opts.apiType || "chat",
      connection: { kind: "reference", name: "test-direct-openai" },
      options: { temperature: 0, maxOutputTokens: 200, ...(opts.options || {}) },
    },
    template: { format: { kind: "jinja2" }, parser: { kind: "prompty" } },
    instructions:
      opts.instructions ??
      "system:\nYou are a helpful assistant. Be very brief.\nuser:\n{{question}}",
    inputs: opts.inputs ?? [
      { name: "question", kind: "string", default: "Say hello in exactly 3 words." },
    ],
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(opts.outputs ? { outputs: opts.outputs } : {}),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe.skipIf(!hasOpenAI)("OpenAI Integration", () => {
  beforeEach(async () => {
    Tracer.clear();
    clearConnections();
    registerExecutor("openai", new OpenAIExecutor());
    registerProcessor("openai", new OpenAIProcessor());

    const { default: OpenAI } = await import("openai");
    registerConnection("test-openai", new OpenAI({ apiKey: OPENAI_API_KEY }));
  });

  afterEach(() => {
    clearConnections();
    Tracer.clear();
  });

  // --- Chat ---
  it("chat completion", { timeout: 30_000 }, async () => {
    const agent = makeAgent();
    const result = await execute(agent, { question: "Say hello in exactly 3 words." });
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  // --- Streaming ---
  it("streaming chat", { timeout: 30_000 }, async () => {
    const agent = makeAgent({
      options: { temperature: 0, maxOutputTokens: 200, additionalProperties: { stream: true } },
    });
    const result = await execute(agent, { question: "Say hello in exactly 3 words." });
    const chunks: string[] = [];
    for await (const chunk of result as AsyncIterable<unknown>) {
      if (typeof chunk === "string" && chunk.length > 0) chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("").length).toBeGreaterThan(0);
  });

  // --- Embedding (requires OPENAI_EMBEDDING_MODEL env var) ---
  it.skipIf(!OPENAI_EMBEDDING_MODEL)("embedding", { timeout: 30_000 }, async () => {
    const agent = makeAgent({
      apiType: "embedding",
      model: OPENAI_EMBEDDING_MODEL!,
      instructions: "Hello world",
      inputs: [],
    });
    const result = await execute(agent);
    expect(Array.isArray(result)).toBe(true);
    expect((result as number[]).length).toBeGreaterThan(0);
    expect(typeof (result as number[])[0]).toBe("number");
  });

  // --- Image (requires OPENAI_IMAGE_MODEL env var) ---
  it.skipIf(!OPENAI_IMAGE_MODEL)("image generation", { timeout: 60_000 }, async () => {
    const agent = makeAgent({
      apiType: "image",
      model: OPENAI_IMAGE_MODEL!,
      instructions: "A simple blue circle on a white background",
      options: { additionalProperties: { size: "1024x1024", n: 1 } },
      inputs: [],
    });
    const result = await execute(agent);
    expect(typeof result).toBe("string");
    // Result is either a URL or base64-encoded image data
    const s = result as string;
    expect(s.startsWith("http") || s.length > 100).toBe(true);
  });

  // --- Structured output ---
  it("structured output", { timeout: 30_000 }, async () => {
    const agent = makeAgent({
      instructions:
        "system:\nYou are a data assistant. Respond with valid JSON matching the schema.\nuser:\nGive me info about Tokyo.",
      outputs: [
        { name: "city", kind: "string" },
        { name: "country", kind: "string" },
        { name: "population", kind: "integer" },
      ],
      inputs: [],
    });
    const result = await execute(agent);
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("city");
    expect(result).toHaveProperty("country");
  });

  // --- Agent loop ---
  it("agent loop with tool calling", { timeout: 60_000 }, async () => {
    const agent = makeAgent({
      instructions:
        "system:\nYou are a helpful assistant. Use the get_weather tool when asked about weather. Be brief.\nuser:\n{{question}}",
      tools: [
        {
          name: "get_weather",
          kind: "function",
          description: "Get the current weather for a city",
          parameters: [
            { name: "city", kind: "string", description: "City name", required: true },
          ],
        },
      ],
    });
    const result = await executeAgent(
      agent,
      { question: "What is the weather in Seattle?" },
      {
        tools: {
          get_weather: (city: string) => `72°F and sunny in ${city}`,
        } as Record<string, (...args: unknown[]) => unknown>,
      },
    );
    expect(typeof result).toBe("string");
    expect((result as string).toLowerCase()).toMatch(/72|sunny|seattle/);
  });

  // --- Streaming + Tools (agent loop with streaming enabled) ---
  it("streaming agent loop with tool calling", { timeout: 60_000 }, async () => {
    const agent = makeAgent({
      instructions:
        "system:\nYou are a helpful assistant. Use the get_weather tool when asked about weather. Be brief.\nuser:\n{{question}}",
      options: { temperature: 0, maxOutputTokens: 200, additionalProperties: { stream: true } },
      tools: [
        {
          name: "get_weather",
          kind: "function",
          description: "Get the current weather for a city",
          parameters: [
            { name: "city", kind: "string", description: "City name", required: true },
          ],
        },
      ],
    });
    // executeAgent should disable streaming internally, run tool loop, and return a string
    const result = await executeAgent(
      agent,
      { question: "What is the weather in Seattle?" },
      {
        tools: {
          get_weather: (city: string) => `72°F and sunny in ${city}`,
        } as Record<string, (...args: unknown[]) => unknown>,
      },
    );
    expect(typeof result).toBe("string");
    expect((result as string).toLowerCase()).toMatch(/72|sunny|seattle/);
  });

  // --- Responses API ---
  it("responses API chat", { timeout: 30_000 }, async () => {
    const agent = makeAgent({ apiType: "responses" });
    const result = await execute(agent, { question: "Say hello in exactly 3 words." });
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  // --- Responses API + tools ---
  it("responses API agent loop with tool calling", { timeout: 60_000 }, async () => {
    const agent = makeAgent({
      apiType: "responses",
      instructions:
        "system:\nYou are a helpful assistant. Use the get_weather tool when asked about weather. Be brief.\nuser:\n{{question}}",
      tools: [
        {
          name: "get_weather",
          kind: "function",
          description: "Get the current weather for a city",
          parameters: [
            { name: "city", kind: "string", description: "City name", required: true },
          ],
        },
      ],
    });
    const result = await executeAgent(
      agent,
      { question: "What is the weather in Seattle?" },
      {
        tools: {
          get_weather: (city: string) => `72°F and sunny in ${city}`,
        } as Record<string, (...args: unknown[]) => unknown>,
      },
    );
    expect(typeof result).toBe("string");
    expect((result as string).toLowerCase()).toMatch(/72|sunny|seattle/);
  });
});

// ---------------------------------------------------------------------------
// Direct OpenAI Integration (api.openai.com — no proxy/compat layer)
// ---------------------------------------------------------------------------

const toolSpec = [
  {
    name: "get_weather",
    kind: "function",
    description: "Get the current weather for a city",
    parameters: [
      { name: "city", kind: "string", description: "City name", required: true },
    ],
  },
];

const toolFns = {
  get_weather: (city: string) => `72°F and sunny in ${city}`,
} as Record<string, (...args: unknown[]) => unknown>;

describe.skipIf(!hasDirectOpenAI)("Direct OpenAI Integration", () => {
  beforeEach(async () => {
    Tracer.clear();
    clearConnections();
    registerExecutor("openai", new OpenAIExecutor());
    registerProcessor("openai", new OpenAIProcessor());

    const { default: OpenAI } = await import("openai");
    registerConnection("test-direct-openai", new OpenAI({
      apiKey: DIRECT_OPENAI_API_KEY,
      baseURL: "https://api.openai.com/v1",  // explicit — override any OPENAI_BASE_URL env var
    }));
  });

  afterEach(() => {
    clearConnections();
    Tracer.clear();
  });

  // --- Chat ---
  it("chat completion", { timeout: 30_000 }, async () => {
    const agent = makeDirectAgent();
    const result = await execute(agent, { question: "Say hello in exactly 3 words." });
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  // --- Streaming ---
  it("streaming chat", { timeout: 30_000 }, async () => {
    const agent = makeDirectAgent({
      options: { temperature: 0, maxOutputTokens: 200, additionalProperties: { stream: true } },
    });
    const result = await execute(agent, { question: "Say hello in exactly 3 words." });
    const chunks: string[] = [];
    for await (const chunk of result as AsyncIterable<unknown>) {
      if (typeof chunk === "string" && chunk.length > 0) chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("").length).toBeGreaterThan(0);
  });

  // --- Structured output ---
  it("structured output", { timeout: 30_000 }, async () => {
    const agent = makeDirectAgent({
      instructions:
        "system:\nYou are a data assistant. Respond with valid JSON matching the schema.\nuser:\nGive me info about Tokyo.",
      outputs: [
        { name: "city", kind: "string" },
        { name: "country", kind: "string" },
        { name: "population", kind: "integer" },
      ],
      inputs: [],
    });
    const result = await execute(agent);
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("city");
    expect(result).toHaveProperty("country");
  });

  // --- Agent loop ---
  it("agent loop with tool calling", { timeout: 60_000 }, async () => {
    const agent = makeDirectAgent({
      instructions:
        "system:\nYou are a helpful assistant. Use the get_weather tool when asked about weather. Be brief.\nuser:\n{{question}}",
      tools: toolSpec,
    });
    const result = await executeAgent(agent, { question: "What is the weather in Seattle?" }, { tools: toolFns });
    expect(typeof result).toBe("string");
    expect((result as string).toLowerCase()).toMatch(/72|sunny|seattle/);
  });

  // --- Streaming + Tools ---
  it("streaming agent loop with tool calling", { timeout: 60_000 }, async () => {
    const agent = makeDirectAgent({
      instructions:
        "system:\nYou are a helpful assistant. Use the get_weather tool when asked about weather. Be brief.\nuser:\n{{question}}",
      options: { temperature: 0, maxOutputTokens: 200, additionalProperties: { stream: true } },
      tools: toolSpec,
    });
    const result = await executeAgent(agent, { question: "What is the weather in Seattle?" }, { tools: toolFns });
    expect(typeof result).toBe("string");
    expect((result as string).toLowerCase()).toMatch(/72|sunny|seattle/);
  });

  // --- Responses API ---
  it("responses API chat", { timeout: 30_000 }, async () => {
    const agent = makeDirectAgent({ apiType: "responses" });
    const result = await execute(agent, { question: "Say hello in exactly 3 words." });
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  // --- Responses API + Tools ---
  it("responses API agent loop with tool calling", { timeout: 60_000 }, async () => {
    const agent = makeDirectAgent({
      apiType: "responses",
      instructions:
        "system:\nYou are a helpful assistant. Use the get_weather tool when asked about weather. Be brief.\nuser:\n{{question}}",
      tools: toolSpec,
    });
    const result = await executeAgent(agent, { question: "What is the weather in Seattle?" }, { tools: toolFns });
    expect(typeof result).toBe("string");
    expect((result as string).toLowerCase()).toMatch(/72|sunny|seattle/);
  });
});
/**
 * Foundry (Azure OpenAI) integration tests — real API calls.
 * Auto-skipped when Azure env vars are not set.
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
import { FoundryExecutor } from "../src/executor.js";
import { FoundryProcessor } from "../src/processor.js";

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

const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_CHAT_DEPLOYMENT = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT;
const AZURE_EMBEDDING_DEPLOYMENT = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION;
const hasFoundry = !!(AZURE_ENDPOINT && AZURE_API_KEY && AZURE_CHAT_DEPLOYMENT);
const hasEmbedding = !!(hasFoundry && AZURE_EMBEDDING_DEPLOYMENT);
// Responses API requires api-version 2025-03-01-preview or later
const hasResponses = !!(hasFoundry && AZURE_API_VERSION && AZURE_API_VERSION >= "2025-03-01");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAgent(opts: {
  apiType?: string;
  instructions?: string;
  deployment?: string;
  options?: Record<string, unknown>;
  tools?: Record<string, unknown>[];
  outputs?: Record<string, unknown>[];
  inputs?: Record<string, unknown>[];
} = {}): Prompty {
  return Prompty.load({
    name: "foundry-integration",
    model: {
      id: opts.deployment || AZURE_CHAT_DEPLOYMENT,
      provider: "foundry",
      apiType: opts.apiType || "chat",
      connection: { kind: "reference", name: "test-foundry" },
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
describe.skipIf(!hasFoundry)("Foundry Integration", () => {
  beforeEach(async () => {
    Tracer.clear();
    clearConnections();
    registerExecutor("foundry", new FoundryExecutor());
    registerProcessor("foundry", new FoundryProcessor());

    const { AzureOpenAI } = await import("openai");
    // Clear OPENAI_BASE_URL to avoid conflict with AzureOpenAI's endpoint param
    const savedBaseURL = process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
    try {
      const client = new AzureOpenAI({
        endpoint: AZURE_ENDPOINT,
        apiKey: AZURE_API_KEY,
        apiVersion: "2024-12-01-preview",
      });
      registerConnection("test-foundry", client);
    } finally {
      if (savedBaseURL !== undefined) process.env.OPENAI_BASE_URL = savedBaseURL;
    }
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

  // --- Embedding ---
  it.skipIf(!hasEmbedding)("embedding", { timeout: 30_000 }, async () => {
    const agent = makeAgent({
      apiType: "embedding",
      deployment: AZURE_EMBEDDING_DEPLOYMENT,
      instructions: "Hello world",
      inputs: [],
    });
    const result = await execute(agent);
    expect(Array.isArray(result)).toBe(true);
    expect((result as number[]).length).toBeGreaterThan(0);
    expect(typeof (result as number[])[0]).toBe("number");
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

  // --- Streaming + Tools ---
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

  // --- Responses API (requires api-version 2025-03-01-preview or later) ---
  it.skipIf(!hasResponses)("responses API chat", { timeout: 30_000 }, async () => {
    const agent = makeAgent({ apiType: "responses" });
    const result = await execute(agent, { question: "Say hello in exactly 3 words." });
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  // --- Responses API + tools ---
  it.skipIf(!hasResponses)("responses API agent loop with tool calling", { timeout: 60_000 }, async () => {
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

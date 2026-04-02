/**
 * Anthropic integration tests — real API calls against Anthropic Messages API.
 * Auto-skipped when ANTHROPIC_API_KEY is not set.
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
import { AnthropicExecutor } from "../src/executor.js";
import { AnthropicProcessor } from "../src/processor.js";

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

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const hasAnthropic = !!ANTHROPIC_API_KEY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAgent(opts: {
  instructions?: string;
  model?: string;
  options?: Record<string, unknown>;
  tools?: Record<string, unknown>[];
  outputs?: Record<string, unknown>[];
  inputs?: Record<string, unknown>[];
} = {}): Prompty {
  return Prompty.load({
    name: "anthropic-integration",
    model: {
      id: opts.model || "claude-sonnet-4-5-20250929",
      provider: "anthropic",
      apiType: "chat",
      connection: { kind: "reference", name: "test-anthropic" },
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
describe.skipIf(!hasAnthropic)("Anthropic Integration", () => {
  beforeEach(async () => {
    Tracer.clear();
    clearConnections();
    registerExecutor("anthropic", new AnthropicExecutor());
    registerProcessor("anthropic", new AnthropicProcessor());

    const AnthropicSDK = (await import("@anthropic-ai/sdk")).default;
    registerConnection("test-anthropic", new AnthropicSDK({ apiKey: ANTHROPIC_API_KEY }));
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
});

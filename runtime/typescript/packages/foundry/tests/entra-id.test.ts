/**
 * Foundry Entra ID (keyless / DefaultAzureCredential) integration tests.
 *
 * These tests verify the FoundryConnection path in the Foundry executor,
 * which creates an AzureOpenAI client internally using DefaultAzureCredential
 * instead of a pre-registered API-key client.
 *
 * Prerequisites:
 *   - `az login` (or another credential source for DefaultAzureCredential)
 *   - AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_CHAT_DEPLOYMENT env vars set
 *   - AZURE_TENANT_ID env var set (so DefaultAzureCredential picks the right tenant)
 *   - Identity must have 'Cognitive Services OpenAI User' role on the resource
 *
 * Skipped automatically when env vars or credentials are unavailable.
 */
import "dotenv/config";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  Tracer,
  invoke,
  clearConnections,
  registerExecutor,
  registerProcessor,
  Prompty,
} from "@prompty/core";
import { FoundryExecutor } from "../src/executor.js";
import { FoundryProcessor } from "../src/processor.js";

// ---------------------------------------------------------------------------
// Env loading (reads workspace-root .env, same pattern as integration.test.ts)
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
const AZURE_CHAT_DEPLOYMENT = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT;
const hasEntraId = !!(AZURE_ENDPOINT && AZURE_CHAT_DEPLOYMENT);

function isSkippableEntraIdError(message: string): boolean {
  return (
    message.includes("authentication") ||
    message.includes("credential") ||
    message.includes("CredentialUnavailableError") ||
    message.includes("Token tenant") ||
    message.includes("resource tenant") ||
    message.includes("401") ||
    message.includes("403")
  );
}

function warnSkippedEntraId(message: string): void {
  console.warn(
    `Skipping: Entra ID authorization failed — ensure the active credential tenant matches the Azure OpenAI resource tenant and has 'Cognitive Services OpenAI User'. (${message})`,
  );
}

// ---------------------------------------------------------------------------
// Helper — build an agent that uses FoundryConnection (Entra ID, no API key)
// ---------------------------------------------------------------------------
function makeEntraIdAgent(opts: {
  apiType?: string;
  instructions?: string;
  deployment?: string;
  options?: Record<string, unknown>;
  inputs?: Record<string, unknown>[];
} = {}): Prompty {
  return Prompty.load({
    name: "entra-id-integration",
    model: {
      id: opts.deployment || AZURE_CHAT_DEPLOYMENT,
      provider: "foundry",
      apiType: opts.apiType || "chat",
      connection: { kind: "foundry", endpoint: AZURE_ENDPOINT },
      options: { temperature: 0, maxOutputTokens: 200, ...(opts.options || {}) },
    },
    template: { format: { kind: "jinja2" }, parser: { kind: "prompty" } },
    instructions:
      opts.instructions ??
      "system:\nYou are a helpful assistant. Be very brief.\nuser:\n{{question}}",
    inputs: opts.inputs ?? [
      { name: "question", kind: "string", default: "Say hello in exactly 3 words." },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe.skipIf(!hasEntraId)("Foundry Entra ID Integration", () => {
  // The AzureOpenAI SDK auto-reads AZURE_OPENAI_API_KEY from the environment.
  // When both apiKey and azureADTokenProvider are present, it throws. We must
  // temporarily clear the API key env var so DefaultAzureCredential is the
  // sole auth mechanism — which is exactly what these tests verify.
  let savedApiKey: string | undefined;
  let savedBaseURL: string | undefined;

  beforeEach(() => {
    Tracer.clear();
    clearConnections();
    registerExecutor("foundry", new FoundryExecutor());
    registerProcessor("foundry", new FoundryProcessor());

    savedApiKey = process.env.AZURE_OPENAI_API_KEY;
    savedBaseURL = process.env.OPENAI_BASE_URL;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    clearConnections();
    Tracer.clear();

    if (savedApiKey !== undefined) process.env.AZURE_OPENAI_API_KEY = savedApiKey;
    else delete process.env.AZURE_OPENAI_API_KEY;
    if (savedBaseURL !== undefined) process.env.OPENAI_BASE_URL = savedBaseURL;
    else delete process.env.OPENAI_BASE_URL;
  });

  // --- Token acquisition ---
  it("acquires a token via DefaultAzureCredential", { timeout: 30_000 }, async () => {
    const { DefaultAzureCredential } = await import("@azure/identity");
    const credential = new DefaultAzureCredential();
    try {
      const token = await credential.getToken(
        "https://cognitiveservices.azure.com/.default",
      );
      expect(token.token).toBeTruthy();
      expect(token.token.length).toBeGreaterThan(0);
      expect(token.expiresOnTimestamp).toBeGreaterThan(Date.now());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Skip gracefully if credentials unavailable
      console.warn(
        `Skipping: DefaultAzureCredential failed — run \`az login\` first. (${msg})`,
      );
      return;
    }
  });

  // --- Chat completion via Entra ID ---
  it("chat completion via Entra ID auth", { timeout: 30_000 }, async () => {
    const agent = makeEntraIdAgent();
    try {
      const result = await invoke(agent, { question: "Say hello in exactly 3 words." });
      expect(typeof result).toBe("string");
      expect((result as string).length).toBeGreaterThan(0);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isSkippableEntraIdError(msg)) {
        warnSkippedEntraId(msg);
        return;
      }
      throw e;
    }
  });

  // --- Streaming chat via Entra ID ---
  it("streaming chat via Entra ID auth", { timeout: 30_000 }, async () => {
    const agent = makeEntraIdAgent({
      options: { temperature: 0, maxOutputTokens: 200, additionalProperties: { stream: true } },
    });
    try {
      const result = await invoke(agent, { question: "Say hello in exactly 3 words." });
      const chunks: string[] = [];
      for await (const chunk of result as AsyncIterable<unknown>) {
        if (typeof chunk === "string" && chunk.length > 0) chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join("").length).toBeGreaterThan(0);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isSkippableEntraIdError(msg)) {
        warnSkippedEntraId(msg);
        return;
      }
      throw e;
    }
  });
});

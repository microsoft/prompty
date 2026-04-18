import { describe, it, expect, vi } from "vitest";
import { ModelInfo, ApiKeyConnection, AnonymousConnection } from "@prompty/core";

// Mock the openai module before importing the function under test
vi.mock("openai", () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    models: {
      list: vi.fn().mockResolvedValue({
        data: [
          { id: "gpt-4o", owned_by: "openai", object: "model", created: 1700000000 },
          { id: "gpt-4o-2024-08-06", owned_by: "openai", object: "model", created: 1700000001 },
          { id: "gpt-3.5-turbo", owned_by: "openai", object: "model", created: 1600000000 },
          { id: "dall-e-3", owned_by: "openai", object: "model", created: 1700000002 },
          { id: "text-embedding-3-small", owned_by: "openai-internal", object: "model", created: 1700000003 },
          { id: "ft:gpt-4o:my-org:custom:abc123", owned_by: "user-org", object: "model", created: 1700000004 },
        ],
      }),
    },
  }));
  return { default: MockOpenAI };
});

import { listModels } from "../src/models.js";

describe("listModels (OpenAI)", () => {
  const connection = new ApiKeyConnection({ apiKey: "test-key" });

  it("returns ModelInfo[] from the API", async () => {
    const models = await listModels(connection);
    expect(models).toHaveLength(6);
    expect(models[0]).toBeInstanceOf(ModelInfo);
  });

  it("sets id and ownedBy from API response", async () => {
    const models = await listModels(connection);
    const gpt4o = models.find((m) => m.id === "gpt-4o")!;
    expect(gpt4o.ownedBy).toBe("openai");
  });

  it("enriches exact-match known models with contextWindow and modalities", async () => {
    const models = await listModels(connection);
    const gpt4o = models.find((m) => m.id === "gpt-4o")!;
    expect(gpt4o.contextWindow).toBe(128_000);
    expect(gpt4o.inputModalities).toEqual(["text", "image"]);
    expect(gpt4o.outputModalities).toEqual(["text"]);
  });

  it("enriches dated variants via prefix matching", async () => {
    const models = await listModels(connection);
    const dated = models.find((m) => m.id === "gpt-4o-2024-08-06")!;
    expect(dated.contextWindow).toBe(128_000);
    expect(dated.inputModalities).toEqual(["text", "image"]);
  });

  it("enriches dall-e-3 (no contextWindow)", async () => {
    const models = await listModels(connection);
    const dalle = models.find((m) => m.id === "dall-e-3")!;
    expect(dalle.contextWindow).toBeUndefined();
    expect(dalle.inputModalities).toEqual(["text"]);
    expect(dalle.outputModalities).toEqual(["image"]);
  });

  it("enriches embedding models with empty outputModalities", async () => {
    const models = await listModels(connection);
    const embed = models.find((m) => m.id === "text-embedding-3-small")!;
    expect(embed.contextWindow).toBe(8_191);
    expect(embed.inputModalities).toEqual(["text"]);
    expect(embed.outputModalities).toEqual([]);
  });

  it("leaves unknown models without enrichment", async () => {
    const models = await listModels(connection);
    const custom = models.find((m) => m.id === "ft:gpt-4o:my-org:custom:abc123")!;
    expect(custom.ownedBy).toBe("user-org");
    expect(custom.contextWindow).toBeUndefined();
    // ModelInfo defaults modalities to [] when not provided
    expect(custom.inputModalities).toEqual([]);
    expect(custom.outputModalities).toEqual([]);
  });

  it("throws for unsupported connection kind", async () => {
    const badConn = new AnonymousConnection();
    await expect(listModels(badConn)).rejects.toThrow(/not supported/);
  });
});

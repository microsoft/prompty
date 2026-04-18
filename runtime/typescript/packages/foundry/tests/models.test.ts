import { describe, it, expect, vi } from "vitest";
import { ModelInfo, ApiKeyConnection, AnonymousConnection } from "@prompty/core";

// Mock the openai module before importing the function under test
vi.mock("openai", () => {
  const MockAzureOpenAI = vi.fn().mockImplementation(() => ({
    models: {
      list: vi.fn().mockResolvedValue({
        data: [
          { id: "gpt-4o", owned_by: "azure", object: "model", created: 1700000000, maxContextLength: 128000 },
          { id: "gpt-35-turbo", owned_by: "azure", object: "model", created: 1600000000 },
          { id: "text-embedding-ada-002", owned_by: "azure", object: "model", created: 1500000000, maxContextLength: 8191 },
        ],
      }),
    },
  }));
  return { AzureOpenAI: MockAzureOpenAI, default: MockAzureOpenAI };
});

import { listAzureModels } from "../src/azure-models.js";

describe("listAzureModels", () => {
  const connection = new ApiKeyConnection({
    apiKey: "test-key",
    endpoint: "https://myresource.openai.azure.com/",
  });

  it("returns ModelInfo[] from the Azure API", async () => {
    const models = await listAzureModels(connection);
    expect(models).toHaveLength(3);
    expect(models[0]).toBeInstanceOf(ModelInfo);
  });

  it("sets id and ownedBy from API response", async () => {
    const models = await listAzureModels(connection);
    const gpt4o = models.find((m) => m.id === "gpt-4o")!;
    expect(gpt4o.ownedBy).toBe("azure");
  });

  it("maps maxContextLength to contextWindow when present", async () => {
    const models = await listAzureModels(connection);
    const gpt4o = models.find((m) => m.id === "gpt-4o")!;
    expect(gpt4o.contextWindow).toBe(128_000);
  });

  it("leaves contextWindow undefined when maxContextLength is absent", async () => {
    const models = await listAzureModels(connection);
    const turbo = models.find((m) => m.id === "gpt-35-turbo")!;
    expect(turbo.contextWindow).toBeUndefined();
  });

  it("does not set modalities (Azure API does not return them)", async () => {
    const models = await listAzureModels(connection);
    for (const m of models) {
      // ModelInfo defaults modalities to [] when not explicitly set
      expect(m.inputModalities).toEqual([]);
      expect(m.outputModalities).toEqual([]);
    }
  });

  it("throws for unsupported connection kind", async () => {
    const badConn = new AnonymousConnection();
    await expect(listAzureModels(badConn)).rejects.toThrow(/not supported/);
  });
});

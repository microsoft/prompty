import { describe, it, expect, vi } from "vitest";
import {
  ModelInfo,
  ApiKeyConnection,
  AnonymousConnection,
  ReferenceConnection,
  registerConnection,
  clearConnections,
} from "@prompty/core";

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

  it("lists deployments from a registered Foundry project reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        value: [
          {
            name: "chat-prod",
            properties: {
              model: { name: "gpt-4o", publisher: "Microsoft" },
              capabilities: {
                maxContextLength: 128000,
                inputModalities: ["text", "image"],
                outputModalities: "text, json",
              },
            },
          },
          { name: "embed-prod", properties: { model: { name: "text-embedding-3-small" } } },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    registerConnection("foundry-project", {
      projectEndpoint: "https://example.services.ai.azure.com/api/projects/demo/",
      getToken: async () => "test-token",
    });

    const models = await listAzureModels(new ReferenceConnection({ name: "foundry-project" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.services.ai.azure.com/api/projects/demo/deployments?api-version=v1",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
    expect(models).toHaveLength(2);
    expect(models[0]).toBeInstanceOf(ModelInfo);
    expect(models[0].id).toBe("chat-prod");
    expect(models[0].displayName).toBe("gpt-4o");
    expect(models[0].ownedBy).toBe("Microsoft");
    expect(models[0].contextWindow).toBe(128000);
    expect(models[0].inputModalities).toEqual(["text", "image"]);
    expect(models[0].outputModalities).toEqual(["text", "json"]);
    expect(models[0].additionalProperties?.name).toBe("chat-prod");

    vi.unstubAllGlobals();
    clearConnections();
  });

  it("surfaces Foundry deployment listing failures with response details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: vi.fn().mockResolvedValue("tenant does not match"),
    }));
    registerConnection("foundry-project", {
      projectEndpoint: "https://example.services.ai.azure.com/api/projects/demo",
      getToken: async () => "test-token",
    });

    await expect(listAzureModels(new ReferenceConnection({ name: "foundry-project" })))
      .rejects.toThrow(/403 Forbidden .*tenant does not match/);

    vi.unstubAllGlobals();
    clearConnections();
  });
});

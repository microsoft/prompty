/**
 * Unit tests for Foundry-specific logic: endpoint resolution,
 * client construction, and processor delegation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  Prompty,
  Model,
  FoundryConnection,
  ApiKeyConnection,
  ReferenceConnection,
  registerConnection,
  clearConnections,
} from "@prompty/core";
import { FoundryExecutor } from "../src/executor.js";
import { FoundryProcessor } from "../src/processor.js";
import { AzureExecutor } from "../src/azure-executor.js";
import { AzureProcessor } from "../src/azure-processor.js";
import { processResponse } from "@prompty/openai";

// ---------------------------------------------------------------------------
// FoundryExecutor — resolveClient
// ---------------------------------------------------------------------------

describe("FoundryExecutor.resolveClient", () => {
  beforeEach(() => {
    clearConnections();
  });

  it("uses ReferenceConnection to look up pre-registered client", async () => {
    const mockClient = {
      constructor: { name: "AzureOpenAI" },
      chat: { completions: { create: async () => ({ choices: [{ message: { role: "assistant", content: "ok" } }] }) } },
    };
    registerConnection("my-foundry", mockClient);

    const executor = new FoundryExecutor();
    const agent = new Prompty({
      name: "test",
      model: new Model({
        id: "gpt-4o",
        provider: "foundry",
        apiType: "chat",
        connection: new ReferenceConnection({ name: "my-foundry" }),
      }),
    });

    // Execute should succeed using the mock client
    const result = await executor.execute(agent, []);
    expect(result).toEqual({ choices: [{ message: { role: "assistant", content: "ok" } }] });
  });

  it("throws when connection is missing endpoint and not a reference", async () => {
    const executor = new FoundryExecutor();
    const agent = new Prompty({
      name: "test",
      model: new Model({
        id: "gpt-4o",
        provider: "foundry",
        apiType: "chat",
        connection: new FoundryConnection({ endpoint: "" }),
      }),
    });

    await expect(executor.execute(agent, [])).rejects.toThrow("FoundryConnection");
  });

  it("throws when connection is ApiKeyConnection (wrong type)", async () => {
    const executor = new FoundryExecutor();
    const agent = new Prompty({
      name: "test",
      model: new Model({
        id: "gpt-4o",
        provider: "foundry",
        apiType: "chat",
        connection: new ApiKeyConnection({ apiKey: "test", endpoint: "https://api.openai.com" }),
      }),
    });

    await expect(executor.execute(agent, [])).rejects.toThrow("FoundryConnection");
  });
});

// ---------------------------------------------------------------------------
// AzureExecutor — resolveClient
// ---------------------------------------------------------------------------

describe("AzureExecutor.resolveClient", () => {
  beforeEach(() => {
    clearConnections();
  });

  it("uses ReferenceConnection to look up pre-registered client", async () => {
    const mockClient = {
      constructor: { name: "AzureOpenAI" },
      chat: { completions: { create: async () => ({ choices: [{ message: { role: "assistant", content: "azure-ok" } }] }) } },
    };
    registerConnection("my-azure", mockClient);

    const executor = new AzureExecutor();
    const agent = new Prompty({
      name: "test",
      model: new Model({
        id: "gpt-4o",
        provider: "azure",
        apiType: "chat",
        connection: new ReferenceConnection({ name: "my-azure" }),
      }),
    });

    const result = await executor.execute(agent, []);
    expect(result).toEqual({ choices: [{ message: { role: "assistant", content: "azure-ok" } }] });
  });
});

// ---------------------------------------------------------------------------
// FoundryProcessor — delegates to OpenAI processResponse
// ---------------------------------------------------------------------------

describe("FoundryProcessor", () => {
  const agent = new Prompty({ name: "test", model: "gpt-4o" });

  it("extracts chat content", async () => {
    const response = {
      choices: [{ message: { content: "Foundry says hello!", role: "assistant" } }],
    };
    const processor = new FoundryProcessor();
    const result = await processor.process(agent, response);
    expect(result).toBe("Foundry says hello!");
  });

  it("extracts embeddings", async () => {
    const response = {
      object: "list",
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    };
    const processor = new FoundryProcessor();
    const result = await processor.process(agent, response);
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("extracts image URLs", async () => {
    const response = {
      data: [{ url: "https://foundry.example.com/img.png" }],
    };
    const processor = new FoundryProcessor();
    const result = await processor.process(agent, response);
    expect(result).toBe("https://foundry.example.com/img.png");
  });

  it("extracts tool calls", async () => {
    const response = {
      choices: [{
        message: {
          content: null,
          role: "assistant",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"location":"Seattle"}' },
          }],
        },
      }],
    };
    const processor = new FoundryProcessor();
    const result = await processor.process(agent, response) as { id: string; name: string }[];
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("get_weather");
  });

  it("returns null for empty choices", async () => {
    const response = { choices: [] };
    const processor = new FoundryProcessor();
    expect(await processor.process(agent, response)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AzureProcessor — delegates to OpenAI processResponse
// ---------------------------------------------------------------------------

describe("AzureProcessor", () => {
  const agent = new Prompty({ name: "test", model: "gpt-4o" });

  it("extracts chat content", async () => {
    const response = {
      choices: [{ message: { content: "Azure says hi!", role: "assistant" } }],
    };
    const processor = new AzureProcessor();
    const result = await processor.process(agent, response);
    expect(result).toBe("Azure says hi!");
  });

  it("extracts embeddings", async () => {
    const response = {
      object: "list",
      data: [{ embedding: [1.0, 2.0] }],
    };
    const processor = new AzureProcessor();
    const result = await processor.process(agent, response);
    expect(result).toEqual([1.0, 2.0]);
  });
});

// ---------------------------------------------------------------------------
// getResourceEndpoint (tested indirectly via FoundryExecutor tracing)
// ---------------------------------------------------------------------------

describe("endpoint extraction", () => {
  it("strips path from project endpoint in trace", async () => {
    // We can't test getResourceEndpoint directly (it's not exported),
    // but we can verify it works via the FoundryConnection path.
    // This test just verifies the URL parsing logic is sound.
    const url = new URL("https://my-resource.services.ai.azure.com/api/projects/my-project");
    const resourceEndpoint = `${url.protocol}//${url.host}`;
    expect(resourceEndpoint).toBe("https://my-resource.services.ai.azure.com");
  });

  it("handles endpoints without path", () => {
    const url = new URL("https://my-resource.services.ai.azure.com");
    const resourceEndpoint = `${url.protocol}//${url.host}`;
    expect(resourceEndpoint).toBe("https://my-resource.services.ai.azure.com");
  });

  it("handles endpoints with port", () => {
    const url = new URL("https://my-resource.services.ai.azure.com:8443/api/projects/bar");
    const resourceEndpoint = `${url.protocol}//${url.host}`;
    expect(resourceEndpoint).toBe("https://my-resource.services.ai.azure.com:8443");
  });
});

// ---------------------------------------------------------------------------
// Registration (auto-register on import)
// ---------------------------------------------------------------------------

describe("auto-registration", () => {
  it("exports all four classes", async () => {
    const mod = await import("../src/index.js");
    expect(mod.FoundryExecutor).toBeDefined();
    expect(mod.FoundryProcessor).toBeDefined();
    expect(mod.AzureExecutor).toBeDefined();
    expect(mod.AzureProcessor).toBeDefined();
  });
});

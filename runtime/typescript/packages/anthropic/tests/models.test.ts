import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  AnonymousConnection,
  ModelInfo,
  ReferenceConnection,
  clearConnections,
  registerConnection,
} from "@prompty/core";
import { afterEach, describe, expect, it } from "vitest";

import { listModels, modelInfoFromWire } from "../src/models.js";

interface DiscoveryVector {
  name: string;
  provider: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

const vectorFile = resolve(
  import.meta.dirname,
  "../../../../../spec/vectors/discovery/discovery_vectors.json",
);
const vectors = (
  JSON.parse(readFileSync(vectorFile, "utf8")) as { vectors: DiscoveryVector[] }
).vectors.filter((vector) => vector.provider === "anthropic");

afterEach(() => clearConnections());

describe("Anthropic discovery vectors", () => {
  for (const vector of vectors) {
    it(vector.name, () => {
      expect(modelInfoFromWire(vector.input).save()).toEqual(vector.expected);
    });
  }
});

describe("listModels (Anthropic)", () => {
  it("consumes every SDK pagination item", async () => {
    registerConnection("anthropic-models", {
      models: {
        list: async () => ({
          async *[Symbol.asyncIterator]() {
            yield { id: "claude-a", display_name: "Claude A", type: "model" };
            yield { id: "claude-b", display_name: "Claude B", type: "model" };
          },
        }),
      },
    });

    const models = await listModels(
      new ReferenceConnection({ name: "anthropic-models" }),
    );

    expect(models).toHaveLength(2);
    expect(models[0]).toBeInstanceOf(ModelInfo);
    expect(models.map((model) => model.id)).toEqual(["claude-a", "claude-b"]);
  });

  it("rejects unsupported connection kinds", async () => {
    await expect(listModels(new AnonymousConnection())).rejects.toThrow(
      /not supported/,
    );
  });
});

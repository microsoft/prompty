import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  catalogModelToModelInfo,
  deploymentToModelInfo,
} from "../src/azure-models.js";

interface DiscoveryVector {
  name: string;
  provider: string;
  shape: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

const vectorFile = resolve(
  import.meta.dirname,
  "../../../../../spec/vectors/discovery/discovery_vectors.json",
);
const vectors = (
  JSON.parse(readFileSync(vectorFile, "utf8")) as { vectors: DiscoveryVector[] }
).vectors.filter((vector) => vector.provider === "foundry");

describe("Foundry discovery vectors", () => {
  for (const vector of vectors) {
    it(vector.name, () => {
      const actual = vector.shape === "catalog"
        ? catalogModelToModelInfo(vector.input)
        : deploymentToModelInfo(vector.input);
      expect(actual.save()).toEqual(vector.expected);
    });
  }
});

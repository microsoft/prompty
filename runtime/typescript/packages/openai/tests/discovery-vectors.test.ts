import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { modelInfoFromWire } from "../src/models.js";

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
).vectors.filter((vector) => vector.provider === "openai");

describe("OpenAI discovery vectors", () => {
  for (const vector of vectors) {
    it(vector.name, () => {
      expect(modelInfoFromWire(vector.input).save()).toEqual(vector.expected);
    });
  }
});

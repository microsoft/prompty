import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createModelInfo, enrichModelInfo } from "../src/index.js";

interface EnrichmentVector {
  name: string;
  provider: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

const vectorFile = resolve(
  import.meta.dirname,
  "../../../../../spec/vectors/discovery/enrichment_vectors.json",
);
const vectors = (
  JSON.parse(readFileSync(vectorFile, "utf8")) as { vectors: EnrichmentVector[] }
).vectors;

describe("model capability enrichment vectors", () => {
  for (const vector of vectors) {
    it(vector.name, () => {
      const actual = createModelInfo(
        enrichModelInfo(vector.provider, vector.input),
      ).save();
      expect(actual).toEqual(vector.expected);
    });
  }
});

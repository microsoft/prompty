/**
 * Model-discovery vector tests — validate the Foundry / Azure OpenAI wire →
 * `ModelInfo` mapping against the shared spec vectors in
 * `spec/vectors/discovery/`.
 *
 * Ported from the Rust reference suite
 * (runtime/rust/prompty-foundry/tests/discovery_vectors.rs) so the contract is
 * executed against the TypeScript emitted models rather than assumed. The
 * `shape` field disambiguates the two Foundry endpoints: `deployment` entries
 * go through `deploymentToModelInfo`, `catalog` entries through
 * `catalogModelToModelInfo`. This test only maps (no network).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { catalogModelToModelInfo, deploymentToModelInfo } from "../src/azure-models.js";

interface DiscoveryVector {
  name: string;
  provider: string;
  shape?: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

const vectorsPath = resolve(
  import.meta.dirname,
  "../../../../../spec/vectors/discovery/discovery_vectors.json",
);

const vectors = (
  JSON.parse(readFileSync(vectorsPath, "utf8")) as { vectors: DiscoveryVector[] }
).vectors.filter((v) => v.provider === "foundry");

describe("Foundry discovery vectors", () => {
  it("exercises at least one vector", () => {
    expect(vectors.length).toBeGreaterThan(0);
  });

  for (const vector of vectors) {
    it(`maps ${vector.name} to the canonical ModelInfo shape`, () => {
      const map = vector.shape === "catalog" ? catalogModelToModelInfo : deploymentToModelInfo;
      const actual = map(vector.input).save();
      expect(actual).toEqual(vector.expected);
    });
  }
});

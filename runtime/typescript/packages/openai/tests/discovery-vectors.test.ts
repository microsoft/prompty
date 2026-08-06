/**
 * Model-discovery vector tests — validate the OpenAI wire → `ModelInfo`
 * mapping against the shared spec vectors in `spec/vectors/discovery/`.
 *
 * Ported from the Rust reference suite
 * (runtime/rust/prompty-openai/tests/discovery_vectors.rs) so the contract is
 * executed against the TypeScript emitted models rather than assumed. The same
 * fixture file is consumed by every runtime so all providers converge on one
 * canonical `ModelInfo` shape. This test only maps (no network), so it
 * exercises `modelInfoFromWire` directly.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { modelInfoFromWire } from "../src/models.js";

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
).vectors.filter((v) => v.provider === "openai");

describe("OpenAI discovery vectors", () => {
  it("exercises at least one vector", () => {
    expect(vectors.length).toBeGreaterThan(0);
  });

  for (const vector of vectors) {
    it(`maps ${vector.name} to the canonical ModelInfo shape`, () => {
      const actual = modelInfoFromWire(vector.input).save();
      expect(actual).toEqual(vector.expected);
    });
  }
});

/**
 * Canonical forward-compatibility tests for open Connection discriminators.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { Connection, ReferenceConnection } from "../src/index.js";

interface ConnectionRoundtripVector {
  name: string;
  operation: "load-save-reload";
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

const vectorsPath = resolve(
  import.meta.dirname,
  "../../../../../spec/vectors/model/connection_roundtrip_vectors.json",
);
const vectors = (
  JSON.parse(readFileSync(vectorsPath, "utf8")) as {
    vectors: ConnectionRoundtripVector[];
  }
).vectors;

describe("Connection roundtrip vectors", () => {
  it.each(vectors)(
    "$name preserves the exact discriminator and payload",
    (vector) => {
      expect(vector.operation).toBe("load-save-reload");

      const loaded = Connection.load(vector.input);
      if (vector.expected.kind === "reference") {
        expect(loaded).toBeInstanceOf(ReferenceConnection);
      } else {
        expect(loaded).not.toBeInstanceOf(ReferenceConnection);
      }

      const saved = loaded.save();
      expect(saved.kind).toBe(vector.expected.kind);
      expect(saved).toEqual(vector.expected);

      const reloaded = Connection.load(saved);
      const resaved = reloaded.save();
      expect(resaved.kind).toBe(vector.expected.kind);
      expect(resaved).toEqual(vector.expected);
    },
  );
});

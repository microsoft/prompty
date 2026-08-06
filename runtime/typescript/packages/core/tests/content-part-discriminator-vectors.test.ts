/**
 * Canonical strict-discriminator tests for the closed ContentPart hierarchy.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ContentPart,
  TextPart,
} from "../src/model/conversation/content-part.js";

interface ContentPartDiscriminatorVector {
  name: string;
  operation: "load" | "load-error";
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

const vectorsPath = resolve(
  import.meta.dirname,
  "../../../../../spec/vectors/model/content_part_discriminator_vectors.json",
);
const vectors = (
  JSON.parse(readFileSync(vectorsPath, "utf8")) as {
    vectors: ContentPartDiscriminatorVector[];
  }
).vectors;

describe("ContentPart discriminator vectors", () => {
  it.each(vectors)("$name enforces closed, case-sensitive kinds", (vector) => {
    if (vector.operation === "load") {
      const loaded = ContentPart.load(vector.input);
      expect(loaded).toBeInstanceOf(TextPart);
      expect(loaded.save()).toEqual(vector.expected);
      return;
    }

    let diagnostic = "";
    try {
      ContentPart.load(vector.input);
    } catch (error) {
      diagnostic = String(error);
    }

    expect(diagnostic).not.toBe("");
    expect(diagnostic).toContain(String(vector.expected.discriminator));
    expect(diagnostic).toContain(String(vector.expected.value));
  });
});

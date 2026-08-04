/**
 * Canonical atomic Property scalar coercion tests backed by shared model vectors.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { Property } from "../src/index.js";

interface PropertyScalarCase {
  name: string;
  input: string | number | boolean;
  expected: {
    kind: string;
    example: string | number | boolean;
  };
}

interface PropertyScalarVector {
  name: string;
  operation: "load";
  cases: PropertyScalarCase[];
}

const vectorsPath = resolve(
  import.meta.dirname,
  "../../../../../spec/vectors/model/property_scalar_coercion_vectors.json",
);
const vector = (
  JSON.parse(readFileSync(vectorsPath, "utf8")) as {
    vectors: PropertyScalarVector[];
  }
).vectors[0];

describe("Property scalar coercion vectors", () => {
  it("coerces all primitive scalar branches atomically", () => {
    expect(vector.name).toBe("all_primitive_property_scalars_coerce_atomically");
    expect(vector.operation).toBe("load");
    expect(vector.cases.map((candidate) => candidate.name)).toEqual([
      "string",
      "integer",
      "float",
      "boolean",
    ]);

    for (const scalarCase of vector.cases) {
      const loaded = Property.fromJson(JSON.stringify(scalarCase.input));
      expect(loaded.kind, scalarCase.name).toBe(scalarCase.expected.kind);
      expect(loaded.example, scalarCase.name).toEqual(
        scalarCase.expected.example,
      );
    }
  });
});

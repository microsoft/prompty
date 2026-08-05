/**
 * Named-collection load/save/reload contracts backed by the shared model vectors.
 *
 * Ported from the Rust reference suite (runtime/rust/prompty/tests/named_collection_vectors.rs)
 * so the contract is executed against the TypeScript emitted models rather than assumed.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { Prompty } from "../src/index.js";

type JsonValue = unknown;
type JsonObject = Record<string, JsonValue>;

interface NamedCollectionVector {
  name: string;
  operation: "load-save-reload" | "load-error";
  collectionPath?: string;
  input: JsonObject;
  expected: JsonObject;
}

const vectorsPath = resolve(
  import.meta.dirname,
  "../../../../../spec/vectors/model/named_collection_vectors.json",
);

const vectors = (
  JSON.parse(readFileSync(vectorsPath, "utf8")) as {
    vectors: NamedCollectionVector[];
  }
).vectors;

const isPlainObject = (value: JsonValue): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Normalize either named-collection wire form into a comparable list of
 * entries carrying an explicit name.
 */
const semanticEntries = (collection: JsonValue): JsonObject[] => {
  if (Array.isArray(collection)) {
    return collection.map((entry, index) => {
      if (!isPlainObject(entry)) {
        throw new Error(`array-form named collection entry ${index} must be an object`);
      }
      return { name: "", ...entry };
    });
  }
  if (isPlainObject(collection)) {
    return Object.keys(collection)
      .sort()
      .map((name) => {
        const entry = collection[name];
        if (!isPlainObject(entry)) {
          throw new Error(`object-form named collection entry ${name} must be an object`);
        }
        return { ...entry, name };
      });
  }
  throw new Error("named collection must be an array or object");
};

/**
 * Every field the vector declares must be present and equal. Fields the
 * vector does not mention are ignored.
 */
const assertSubset = (actual: JsonValue, expected: JsonValue, path: string): void => {
  if (!isPlainObject(expected)) {
    expect(actual, `${path}`).toEqual(expected);
    return;
  }
  expect(isPlainObject(actual), `${path}: expected an object, got ${typeof actual}`).toBe(true);
  const actualObject = actual as JsonObject;
  for (const [key, expectedValue] of Object.entries(expected)) {
    expect(
      Object.prototype.hasOwnProperty.call(actualObject, key),
      `${path}: missing field "${key}"`,
    ).toBe(true);
    assertSubset(actualObject[key], expectedValue, `${path}.${key}`);
  }
};

const assertNamedCollection = (
  vectorName: string,
  collection: JsonValue,
  expected: JsonObject,
): void => {
  const expectedFormat = expected.collectionFormat as string;
  const actualFormat = Array.isArray(collection) ? "array" : "object";
  expect(actualFormat, `[${vectorName}] named collection wire form`).toBe(expectedFormat);

  // wireEntries assert on the raw saved payload: each is {index, absentFields},
  // requiring the entry at that position never materializes a synthetic field.
  const wireEntries = expected.wireEntries as
    | Array<{ index: number; absentFields?: string[] }>
    | undefined;
  if (wireEntries !== undefined) {
    const rawEntries = collection as JsonValue[];
    for (const assertion of wireEntries) {
      const entry = rawEntries[assertion.index];
      expect(
        isPlainObject(entry),
        `[${vectorName}] wire entry ${assertion.index} must be an object`,
      ).toBe(true);
      for (const field of assertion.absentFields ?? []) {
        expect(
          Object.prototype.hasOwnProperty.call(entry as JsonObject, field),
          `[${vectorName}] wire entry ${assertion.index} unexpectedly materialized "${field}"`,
        ).toBe(false);
      }
    }
  }

  const actualEntries = semanticEntries(collection);
  const expectedEntries = expected.entries as JsonObject[];
  expect(actualEntries.length, `[${vectorName}] named collection entry count`).toBe(
    expectedEntries.length,
  );

  const absentEntryFields = expected.absentEntryFields as string[] | undefined;
  if (absentEntryFields !== undefined) {
    for (const entry of actualEntries) {
      for (const field of absentEntryFields) {
        expect(
          Object.prototype.hasOwnProperty.call(entry, field),
          `[${vectorName}] entry ${String(entry.name)} unexpectedly populated "${field}" ` +
            `with ${JSON.stringify(entry[field])}`,
        ).toBe(false);
      }
    }
  }

  if (expected.preserveOrder === true) {
    expectedEntries.forEach((expectedEntry, index) => {
      assertSubset(actualEntries[index], expectedEntry, `${vectorName}.entries[${index}]`);
    });
    return;
  }

  const actualByName = new Map(actualEntries.map((entry) => [String(entry.name), entry]));
  for (const expectedEntry of expectedEntries) {
    const name = String(expectedEntry.name);
    const actualEntry = actualByName.get(name);
    expect(actualEntry, `[${vectorName}] missing named entry "${name}"`).toBeDefined();
    assertSubset(actualEntry, expectedEntry, `${vectorName}.entries.${name}`);
  }
};

describe("named collection vectors", () => {
  const roundtripVectors = vectors.filter((vector) => vector.operation === "load-save-reload");
  const rejectionVectors = vectors.filter((vector) => vector.operation === "load-error");

  it("covers both halves of the contract", () => {
    expect(roundtripVectors.length).toBeGreaterThan(0);
    expect(rejectionVectors.length).toBeGreaterThan(0);
  });

  describe.each(roundtripVectors.map((vector) => [vector.name, vector] as const))(
    "%s",
    (_name, vector) => {
      it("round-trips through load, save and reload", () => {
        const collectionPath = vector.collectionPath as string;

        const loaded = Prompty.load(vector.input);
        const saved = loaded.save() as JsonObject;
        expect(
          Object.prototype.hasOwnProperty.call(saved, collectionPath),
          `[${vector.name}] missing collection "${collectionPath}" after save`,
        ).toBe(true);
        assertNamedCollection(vector.name, saved[collectionPath], vector.expected);

        const reloaded = Prompty.load(saved);
        const resaved = reloaded.save() as JsonObject;
        expect(
          Object.prototype.hasOwnProperty.call(resaved, collectionPath),
          `[${vector.name}] reload lost collection "${collectionPath}"`,
        ).toBe(true);
        assertNamedCollection(vector.name, resaved[collectionPath], vector.expected);
      });
    },
  );

  describe.each(rejectionVectors.map((vector) => [vector.name, vector] as const))(
    "%s",
    (_name, vector) => {
      it("rejects the invalid named collection entry", () => {
        expect(
          () => Prompty.load(vector.input),
          `[${vector.name}] expected rejection at ${String(vector.expected.path)} ` +
            `(category ${String(vector.expected.valueCategory)})`,
        ).toThrow();
      });
    },
  );
});

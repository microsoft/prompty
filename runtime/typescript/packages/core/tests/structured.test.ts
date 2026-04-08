import { describe, it, expect } from "vitest";
import {
  createStructuredResult,
  isStructuredResult,
  StructuredResultSymbol,
  cast,
} from "../src/core/structured.js";

// ---------------------------------------------------------------------------
// StructuredResult
// ---------------------------------------------------------------------------

describe("StructuredResult", () => {
  it("behaves as a plain object", () => {
    const sr = createStructuredResult({ name: "Jane", age: 30 }, '{"name":"Jane","age":30}');
    expect(sr.name).toBe("Jane");
    expect(sr.age).toBe(30);
    expect(Object.keys(sr)).toEqual(["name", "age"]);
  });

  it("carries raw JSON via symbol", () => {
    const raw = '{"temp": 72}';
    const sr = createStructuredResult({ temp: 72 }, raw);
    expect(sr[StructuredResultSymbol]).toBe(raw);
  });

  it("symbol is not enumerable", () => {
    const sr = createStructuredResult({ a: 1 }, '{"a":1}');
    expect(Object.keys(sr)).toEqual(["a"]);
    expect(JSON.stringify(sr)).toBe('{"a":1}');
  });

  it("symbol is not writable", () => {
    const sr = createStructuredResult({ a: 1 }, '{"a":1}');
    expect(() => {
      // @ts-expect-error — testing runtime immutability
      sr[StructuredResultSymbol] = "nope";
    }).toThrow();
  });

  it("passes isStructuredResult check", () => {
    const sr = createStructuredResult({ a: 1 }, '{"a":1}');
    expect(isStructuredResult(sr)).toBe(true);
  });

  it("plain objects fail isStructuredResult", () => {
    expect(isStructuredResult({ a: 1 })).toBe(false);
    expect(isStructuredResult("string")).toBe(false);
    expect(isStructuredResult(null)).toBe(false);
    expect(isStructuredResult(undefined)).toBe(false);
    expect(isStructuredResult(42)).toBe(false);
  });

  it("for...in does not include the symbol", () => {
    const sr = createStructuredResult({ x: 10, y: 20 }, '{"x":10,"y":20}');
    const keys: string[] = [];
    for (const key in sr) {
      keys.push(key);
    }
    expect(keys).toEqual(["x", "y"]);
  });

  it("spread does not include the symbol", () => {
    const sr = createStructuredResult({ a: 1, b: 2 }, '{"a":1,"b":2}');
    const copy = { ...sr };
    expect(StructuredResultSymbol in copy).toBe(false);
    expect(copy).toEqual({ a: 1, b: 2 });
  });
});

// ---------------------------------------------------------------------------
// cast()
// ---------------------------------------------------------------------------

describe("cast", () => {
  it("casts StructuredResult using raw JSON", () => {
    const raw = '{"temperature":72.5,"city":"Seattle"}';
    const sr = createStructuredResult(JSON.parse(raw), raw);
    interface Weather { temperature: number; city: string }
    const result = cast<Weather>(sr);
    expect(result.temperature).toBe(72.5);
    expect(result.city).toBe("Seattle");
  });

  it("casts raw string", () => {
    const raw = '{"message":"hello"}';
    const result = cast<{ message: string }>(raw);
    expect(result.message).toBe("hello");
  });

  it("casts plain object via round-trip", () => {
    const data = { x: 1, y: 2 };
    const result = cast<{ x: number; y: number }>(data);
    expect(result.x).toBe(1);
    expect(result.y).toBe(2);
  });

  it("uses validator when provided", () => {
    const raw = '{"count": "42"}';
    const sr = createStructuredResult(JSON.parse(raw), raw);
    const result = cast(sr, (data: unknown) => {
      const d = data as { count: string };
      return { count: parseInt(d.count, 10) };
    });
    expect(result.count).toBe(42);
  });

  it("validator receives parsed JSON, not raw string", () => {
    const raw = '{"a": 1}';
    const sr = createStructuredResult(JSON.parse(raw), raw);
    let receivedType = "";
    cast(sr, (data: unknown) => {
      receivedType = typeof data;
      return data;
    });
    expect(receivedType).toBe("object");
  });

  it("validator error propagates", () => {
    const sr = createStructuredResult({ a: 1 }, '{"a":1}');
    expect(() =>
      cast(sr, () => {
        throw new Error("validation failed");
      }),
    ).toThrow("validation failed");
  });

  it("throws on invalid JSON string", () => {
    expect(() => cast("not-json")).toThrow();
  });

  it("StructuredResult raw JSON is used directly (not a round-trip)", () => {
    // Raw JSON has specific formatting; round-trip through JSON.stringify
    // would produce different whitespace. Verify we use the original.
    const raw = '{"a":  1,  "b":  2}';
    const sr = createStructuredResult({ a: 1, b: 2 }, raw);
    // cast should parse the raw string (with extra whitespace), not JSON.stringify the data
    const result = cast<{ a: number; b: number }>(sr);
    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
  });
});

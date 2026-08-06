/**
 * Wire format vector tests — validate against shared spec vectors.
 *
 * Reads `spec/vectors/wire/wire_vectors.json` and asserts that this package's
 * request-body construction matches the canonical expectation for every
 * Anthropic-provider vector.
 *
 * Ported from the Rust reference implementation at
 * `runtime/rust/prompty-anthropic/tests/vectors.rs`.
 *
 * Selection is data-driven rather than a hand-maintained list of names, so a
 * newly added Anthropic vector is executed automatically instead of silently
 * going unported. The count assertion below is the guard against the opposite
 * failure — a vector disappearing without anyone noticing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Message, Prompty } from "@prompty/core";
import type { ContentPart } from "@prompty/core";
import { describe, expect, it } from "vitest";

import { buildChatArgs } from "../src/wire.js";

interface WireVector {
  name: string;
  description: string;
  input: {
    provider?: string;
    apiType?: string;
    model_id?: string;
    messages: { role: string; content: { kind: string; value: string; mediaType?: string }[] }[];
    tools?: unknown[];
    options?: Record<string, unknown>;
    outputs?: unknown[];
  };
  expected: { request_body: Record<string, unknown> };
}

const VECTOR_PATH = resolve(import.meta.dirname, "../../../../../spec/vectors/wire/wire_vectors.json");

const allVectors: WireVector[] = JSON.parse(readFileSync(VECTOR_PATH, "utf8"));
const vectors = allVectors.filter((v) => v.input.provider === "anthropic");

/** Build Message objects from the vector's message/content description. */
function buildMessages(input: WireVector["input"]): Message[] {
  return input.messages.map((m) => {
    const parts: ContentPart[] = m.content.map((p) => {
      switch (p.kind) {
        case "text":
          return { kind: "text", value: p.value } as ContentPart;
        case "image":
          return { kind: "image", source: p.value, ...(p.mediaType && { mediaType: p.mediaType }) } as ContentPart;
        case "audio":
          return { kind: "audio", source: p.value, ...(p.mediaType && { mediaType: p.mediaType }) } as ContentPart;
        default:
          throw new Error(`Unknown content kind: ${p.kind}`);
      }
    });
    return new Message({ role: m.role as Message["role"], parts });
  });
}

/** Build a Prompty agent from the vector's model/tools/options/outputs fields. */
function buildAgent(input: WireVector["input"]): Prompty {
  const data: Record<string, unknown> = {
    name: "test",
    kind: "prompt",
    model: {
      id: input.model_id ?? "claude-sonnet-4-5-20250929",
      apiType: input.apiType ?? "chat",
      provider: input.provider ?? "anthropic",
    },
    instructions: "test",
  };

  if (input.options && Object.keys(input.options).length > 0) {
    (data.model as Record<string, unknown>).options = input.options;
  }
  if (input.tools && input.tools.length > 0) {
    data.tools = input.tools;
  }
  if (input.outputs && input.outputs.length > 0) {
    data.outputs = input.outputs;
  }

  return Prompty.load(data);
}

describe("wire vectors (anthropic)", () => {
  it("executes every Anthropic vector in the shared spec file", () => {
    // Guards against a vector being removed, or the provider filter silently
    // matching nothing, either of which would make this suite vacuously green.
    expect(vectors.length).toBe(6);
    expect(allVectors.length).toBe(28);
  });

  for (const vector of vectors) {
    it(`${vector.name} — ${vector.description}`, () => {
      const apiType = vector.input.apiType ?? "chat";
      if (apiType !== "chat" && apiType !== "agent") {
        throw new Error(`Unsupported apiType for the Anthropic provider: ${apiType}`);
      }
      const actual = buildChatArgs(buildAgent(vector.input), buildMessages(vector.input));
      expect(actual).toEqual(vector.expected.request_body);
    });
  }
});

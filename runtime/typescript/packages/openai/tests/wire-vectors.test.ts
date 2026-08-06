/**
 * Wire format vector tests — validate against shared spec vectors.
 *
 * Reads `spec/vectors/wire/wire_vectors.json` and asserts that this package's
 * request-body construction matches the canonical expectation for every
 * OpenAI-provider vector.
 *
 * Ported from the Rust reference implementation at
 * `runtime/rust/prompty-openai/tests/wire_vectors.rs`.
 *
 * Selection is data-driven rather than a hand-maintained list of names, so a
 * newly added OpenAI vector is executed automatically instead of silently going
 * unported. The count assertion below is the guard against the opposite failure
 * — a vector disappearing without anyone noticing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Message, Prompty } from "@prompty/core";
import type { ContentPart } from "@prompty/core";
import { describe, expect, it } from "vitest";

import { buildChatArgs, buildEmbeddingArgs, buildImageArgs, buildResponsesArgs } from "../src/wire.js";

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
const vectors = allVectors.filter((v) => (v.input.provider ?? "openai") === "openai");

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
      id: input.model_id ?? "gpt-4",
      apiType: input.apiType ?? "chat",
      provider: input.provider ?? "openai",
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

function buildRequest(vector: WireVector): Record<string, unknown> {
  const agent = buildAgent(vector.input);
  const messages = buildMessages(vector.input);

  switch (vector.input.apiType ?? "chat") {
    case "chat":
    case "agent":
      return buildChatArgs(agent, messages);
    case "responses":
      return buildResponsesArgs(agent, messages);
    case "embedding":
      return buildEmbeddingArgs(agent, messages);
    case "image":
      return buildImageArgs(agent, messages);
    default:
      throw new Error(`Unknown apiType: ${vector.input.apiType}`);
  }
}

describe("wire vectors (openai)", () => {
  it("executes every OpenAI vector in the shared spec file", () => {
    // Guards against a vector being removed, or the provider filter silently
    // matching nothing, either of which would make this suite vacuously green.
    expect(vectors.length).toBe(23);
    expect(allVectors.length).toBe(29);
  });

  for (const vector of vectors) {
    it(`${vector.name} — ${vector.description}`, () => {
      expect(buildRequest(vector)).toEqual(vector.expected.request_body);
    });
  }
});

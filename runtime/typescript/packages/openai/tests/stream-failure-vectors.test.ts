import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FailureChunk, Agent, StreamChunk } from "@prompty/core";
import { describe, expect, it } from "vitest";

import { processResponse } from "../src/processor.js";

interface StreamFailureVector {
  name: string;
  input: {
    provider: string;
    events: Array<
      | { kind: "provider"; value: Record<string, unknown> }
      | { kind: "transportError"; message: string }
    >;
  };
  expected: { chunks: unknown[] };
}

function loadVectors(): StreamFailureVector[] {
  const path = resolve(
    import.meta.dirname,
    "../../../../../spec/vectors/process/stream_failure_vectors.json",
  );
  return JSON.parse(readFileSync(path, "utf8")) as StreamFailureVector[];
}

function responseFromVector(
  vector: StreamFailureVector,
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
      for (const event of vector.input.events) {
        if (event.kind === "transportError") {
          throw new Error(event.message);
        }
        yield event.value;
      }
    },
  };
}

function closableResponseFromVector(
  vector: StreamFailureVector,
  onClose: () => void,
): AsyncIterable<unknown> {
  const events = vector.input.events;
  let index = 0;
  return {
    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      return {
        async next(): Promise<IteratorResult<unknown>> {
          const event = events[index++];
          if (event === undefined) return { done: true, value: undefined };
          if (event.kind === "transportError") {
            throw new Error(event.message);
          }
          return { done: false, value: event.value };
        },
        async return(): Promise<IteratorResult<unknown>> {
          onClose();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

describe("OpenAI classified stream failure vectors", () => {
  it("closes the provider stream when the consumer stops early", async () => {
    let closeCount = 0;
    const response: AsyncIterable<unknown> = {
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        return {
          async next(): Promise<IteratorResult<unknown>> {
            return {
              done: false,
              value: { choices: [{ delta: { content: "partial" } }] },
            };
          },
          async return(): Promise<IteratorResult<unknown>> {
            closeCount += 1;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const agent = new Agent({ name: "stream-cancel", model: "gpt-test" });

    for await (const item of processResponse(
      agent,
      response,
    ) as AsyncIterable<unknown>) {
      expect(item).toBe("partial");
      break;
    }

    expect(closeCount).toBe(1);
  });

  for (const vector of loadVectors()) {
    it(vector.name, async () => {
      expect(vector.input.provider).toBe("openai");
      const agent = new Agent({ name: "stream-vector", model: "gpt-test" });
      const processed = processResponse(agent, responseFromVector(vector));
      const actual: unknown[] = [];

      for await (const item of processed as AsyncIterable<unknown>) {
        if (item instanceof FailureChunk) {
          const saved = item.save();
          const loaded = StreamChunk.load(saved);
          expect(loaded).toBeInstanceOf(FailureChunk);
          expect(loaded.save()).toEqual(saved);
          actual.push(saved);
        } else {
          actual.push({ kind: "text", value: item });
        }
      }

      expect(actual).toEqual(vector.expected.chunks);
    });

    it(`${vector.name} closes the provider stream`, async () => {
      let closed = false;
      const agent = new Agent({ name: "stream-vector", model: "gpt-test" });
      const processed = processResponse(
        agent,
        closableResponseFromVector(vector, () => {
          closed = true;
        }),
      );

      for await (const _ of processed as AsyncIterable<unknown>) {
        // Consume the terminal failure chunk.
      }

      expect(closed).toBe(true);
    });
  }
});

import { FailureChunk, Agent } from "@prompty/core";
import { describe, expect, it } from "vitest";

import { processResponse } from "../src/processor.js";

describe("Anthropic classified stream failures", () => {
  it("closes the provider stream when the consumer stops early", async () => {
    let closeCount = 0;
    const response: AsyncIterable<unknown> = {
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        return {
          async next(): Promise<IteratorResult<unknown>> {
            return {
              done: false,
              value: {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "partial" },
              },
            };
          },
          async return(): Promise<IteratorResult<unknown>> {
            closeCount += 1;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const agent = new Agent({ name: "stream-cancel", model: "claude-test" });

    for await (const item of processResponse(
      agent,
      response,
    ) as AsyncIterable<unknown>) {
      expect(item).toBe("partial");
      break;
    }

    expect(closeCount).toBe(1);
  });

  it("closes the provider stream after a transport failure", async () => {
    let closed = false;
    const response: AsyncIterable<unknown> = {
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        return {
          async next(): Promise<IteratorResult<unknown>> {
            throw new Error("SSE stream error: connection reset");
          },
          async return(): Promise<IteratorResult<unknown>> {
            closed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const agent = new Agent({ name: "stream-failure", model: "claude-test" });
    const processed = processResponse(agent, response);
    const chunks: unknown[] = [];

    for await (const chunk of processed as AsyncIterable<unknown>) {
      chunks.push(chunk);
    }

    expect(closed).toBe(true);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBeInstanceOf(FailureChunk);
    const failure = chunks[0] as FailureChunk;
    expect(failure.failure.outcome).toBe("indeterminate");
    expect(failure.failure.message).toBe("SSE stream error: connection reset");
  });
});

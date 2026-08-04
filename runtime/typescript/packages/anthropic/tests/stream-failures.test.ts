import { FailureChunk, Prompty } from "@prompty/core";
import { describe, expect, it } from "vitest";

import { processResponse } from "../src/processor.js";

describe("Anthropic classified stream failures", () => {
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
    const agent = new Prompty({ name: "stream-failure", model: "claude-test" });
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

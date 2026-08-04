import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { OpenAIProcessor } from "@prompty/openai";
import { beforeEach, describe, expect, it } from "vitest";

import type { EventCallback } from "../src/core/agent-events.js";
import type { Executor } from "../src/core/interfaces.js";
import { StreamFailureError, turn } from "../src/core/pipeline.js";
import {
  clearCache,
  registerExecutor,
  registerParser,
  registerProcessor,
  registerRenderer,
} from "../src/core/registry.js";
import { Prompty } from "../src/model/agent/prompty.js";
import { PromptyChatParser } from "../src/parsers/prompty.js";
import { NunjucksRenderer } from "../src/renderers/nunjucks.js";

interface StreamFailureVector {
  name: string;
  input: {
    events: Array<{ kind: "provider"; value: Record<string, unknown> } | { kind: "transportError"; message: string }>;
  };
  expected: { partialText: string; requiresReconciliation: boolean; completionCommitted: boolean };
}

const PROVIDER = "stream-failure-vector";

function loadVectors(): StreamFailureVector[] {
  const path = resolve(import.meta.dirname, "../../../../../spec/vectors/process/stream_failure_vectors.json");
  return JSON.parse(readFileSync(path, "utf8")) as StreamFailureVector[];
}

class VectorExecutor implements Executor {
  constructor(private readonly vector: StreamFailureVector) {}

  async execute(): Promise<AsyncIterable<unknown>> {
    const events = this.vector.input.events;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
        for (const event of events) {
          if (event.kind === "transportError") {
            throw new Error(event.message);
          }
          yield event.value;
        }
      },
    };
  }
}

function makeAgent(): Prompty {
  return Prompty.load({
    name: "stream-failure-vector",
    model: { id: "gpt-test", provider: PROVIDER },
    instructions: "user:\nHello",
  });
}

describe("turn classified stream failures", () => {
  beforeEach(() => {
    clearCache();
    registerRenderer("nunjucks", new NunjucksRenderer());
    registerParser("prompty", new PromptyChatParser());
  });

  for (const vector of loadVectors()) {
    it(vector.name, async () => {
      registerExecutor(PROVIDER, new VectorExecutor(vector));
      registerProcessor(PROVIDER, new OpenAIProcessor());
      const events: Array<{ type: string; data: Record<string, unknown> }> = [];
      const onEvent: EventCallback = (type, data) => events.push({ type, data });

      const error = await turn(makeAgent(), {}, { onEvent }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(StreamFailureError);
      const failure = error as StreamFailureError;
      expect(failure.partialContent).toBe(vector.expected.partialText);
      expect(failure.requiresReconciliation).toBe(vector.expected.requiresReconciliation);
      expect(events.some(event => event.type === "done")).toBe(vector.expected.completionCommitted);
      expect(events.some(event => event.type === "turn_end" && event.data.status === "success")).toBe(
        vector.expected.completionCommitted,
      );
    });
  }
});

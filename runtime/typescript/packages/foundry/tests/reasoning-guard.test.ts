import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Agent,
  Model,
  ModelOptions,
  ReferenceConnection,
  clearConnections,
  registerConnection,
} from "@prompty/core";
import { OpenAIExecutor } from "@prompty/openai";
import { FoundryExecutor } from "../src/executor.js";
import { AzureExecutor } from "../src/azure-executor.js";

afterEach(() => {
  clearConnections();
  vi.restoreAllMocks();
});

describe("reasoning guard at the SDK boundary", () => {
  for (const Executor of [OpenAIExecutor, FoundryExecutor, AzureExecutor]) {
    for (const apiType of ["chat", "responses"]) {
      for (const stream of [false, true]) {
        for (const model of ["o3-mini", "gpt-4o"]) {
          it(`${Executor.name} ${apiType} stream=${stream} ${model}`, async () => {
            vi.spyOn(console, "warn").mockImplementation(() => {});
            const create = vi.fn(async () =>
              stream ? { async *[Symbol.asyncIterator]() {} } : {},
            );
            registerConnection("guard", {
              chat: { completions: { create } },
              responses: { create },
            });
            const options = new ModelOptions({
              temperature: 0.5,
              reasoningEffort: "high",
              additionalProperties: {
                stream,
                temperature: 0.8,
                top_p: 0,
                top_k: 0,
                frequency_penalty: 0,
                presence_penalty: 0,
                reasoning_effort: "low",
              },
            });
            const agent = new Agent({
              model: new Model({
                id: model,
                apiType,
                options,
                connection: new ReferenceConnection({ name: "guard" }),
              }),
            });
            await new Executor().execute(agent, []);
            expect(create).toHaveBeenCalledOnce();
            const args = create.mock.calls[0][0] as unknown as Record<
              string,
              unknown
            >;
            expect(args.stream).toBe(stream);
            if (model === "o3-mini") {
              for (const key of [
                "temperature",
                "top_p",
                "top_k",
                "frequency_penalty",
                "presence_penalty",
              ])
                expect(args).not.toHaveProperty(key);
              expect(args.reasoning_effort).toBe("high");
            } else {
              expect(args).not.toHaveProperty("reasoning_effort");
              expect(args.temperature).toBe(0.5);
            }
            expect(options.temperature).toBe(0.5);
          });
        }
      }
    }
  }
});

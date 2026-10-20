import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Agent, Model, ModelOptions } from "@prompty/core";
import { describe, expect, it, vi } from "vitest";
import { buildChatArgs, buildResponsesArgs } from "../src/wire.js";

const vectors = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../../../../../schema/model/conformance/openai-reasoning-guard.json",
    ),
    "utf8",
  ),
) as Array<{
  name: string;
  model: string;
  options: Record<string, unknown>;
  absent: string[];
  present: Record<string, unknown>;
}>;

describe("shared OpenAI execution reasoning guards", () => {
  for (const builder of [buildChatArgs, buildResponsesArgs]) {
    it(`${builder.name}: maps reasoningEffort from plain options`, () => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const agent = new Agent({ model: new Model({ id: "o3-mini" }) });
        agent.model!.options = {
          reasoningEffort: "high",
          temperature: 0,
        } as ModelOptions;
        const args = builder(agent, []);
        expect(args.reasoning_effort).toBe("high");
        expect(args).not.toHaveProperty("temperature");
        expect(agent.model!.options.temperature).toBe(0);
      } finally {
        warning.mockRestore();
      }
    });
    for (const vector of vectors) {
      it(`${builder.name}: ${vector.name}`, () => {
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const options = new ModelOptions(vector.options);
          const original = JSON.stringify(options);
          const agent = new Agent({
            model: new Model({ id: vector.model, options }),
          });
          const args = builder(agent, []);
          for (const key of vector.absent) expect(args).not.toHaveProperty(key);
          for (const [key, value] of Object.entries(vector.present))
            expect(args[key]).toEqual(value);
          expect(JSON.stringify(options)).toBe(original);
          // The generated mapper is a rename-only contract, even on reasoning models.
          if (vector.options.temperature !== undefined)
            expect(options.toWire("openai").temperature).toBe(
              vector.options.temperature,
            );
        } finally {
          warning.mockRestore();
        }
      });
    }
  }
});

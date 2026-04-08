/**
 * Parametric test — loads every .prompty file from the shared prompts dir
 * and validates it loads without error.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { load } from "@prompty/core";
import { readdirSync } from "node:fs";
import { resolve, extname } from "node:path";

const PROMPTS_DIR = resolve(import.meta.dirname, "../../prompts");

// Set dummy env vars so ${env:...} references resolve during loading
beforeAll(() => {
  process.env.OPENAI_API_KEY ??= "test-key-for-loading";
});

// Discover all .prompty files
const promptyFiles = readdirSync(PROMPTS_DIR)
  .filter((f) => extname(f) === ".prompty")
  .sort();

describe("Prompty file loading", () => {
  it("discovers at least one .prompty file", () => {
    expect(promptyFiles.length).toBeGreaterThan(0);
  });

  describe.each(promptyFiles)("%s", (filename) => {
    const filepath = resolve(PROMPTS_DIR, filename);

    it("loads without error", () => {
      const agent = load(filepath);
      expect(agent).toBeDefined();
    });

    it("has a name", () => {
      const agent = load(filepath);
      expect(agent.name).toBeTruthy();
    });

    it("has a model", () => {
      const agent = load(filepath);
      expect(agent.model).toBeDefined();
      expect(agent.model.id).toBeTruthy();
    });

    it("has instructions from the markdown body", () => {
      const agent = load(filepath);
      expect(agent.instructions).toBeTruthy();
      expect(agent.instructions!.length).toBeGreaterThan(0);
    });

    it("has a provider", () => {
      const agent = load(filepath);
      expect(agent.model.provider).toBeTruthy();
    });
  });
});

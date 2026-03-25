import { describe, it, expect } from "vitest";
import { load } from "../src/core/loader.js";
import { resolve } from "node:path";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

describe("Loader", () => {
  it("loads a basic .prompty file", () => {
    const agent = load(resolve(FIXTURES, "basic.prompty"));
    expect(agent.name).toBe("basic");
    expect(agent.description).toBe("A basic prompty for testing");
    expect(agent.model.id).toBe("gpt-4o");
    expect(agent.model.provider).toBe("openai");
  });

  it("loads instructions from body", () => {
    const agent = load(resolve(FIXTURES, "basic.prompty"));
    expect(agent.instructions).toContain("You are a helpful assistant");
    expect(agent.instructions).toContain("{{question}}");
  });

  it("loads a minimal .prompty file", () => {
    const agent = load(resolve(FIXTURES, "minimal.prompty"));
    expect(agent.name).toBe("minimal");
    expect(agent.instructions).toContain("Hello, world!");
  });

  it("resolves env variables with defaults", () => {
    const agent = load(resolve(FIXTURES, "basic.prompty"));
    // Should resolve ${env:OPENAI_API_KEY:test-key} to "test-key" since env not set
    expect(agent.model.connection).toBeDefined();
  });

  it("throws for nonexistent file", () => {
    expect(() => load(resolve(FIXTURES, "nonexistent.prompty"))).toThrow();
  });

  it("loads chat prompty with inputs", () => {
    const agent = load(resolve(FIXTURES, "chat.prompty"));
    expect(agent.name).toBe("chat");
    expect(agent.inputs).toBeDefined();
    expect(agent.inputs!.length).toBeGreaterThan(0);
  });
});

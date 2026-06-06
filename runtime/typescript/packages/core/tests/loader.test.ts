import { describe, it, expect } from "vitest";
import { load } from "../src/core/loader.js";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

  it("rejects JavaScript frontmatter without evaluating it", () => {
    const root = mkdtempSync(join(tmpdir(), "prompty-loader-"));
    const marker = join(root, "executed.txt");
    const prompt = join(root, "bad.prompty");
    writeFileSync(
      prompt,
      `---js\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed")\n---\nHello\n`,
      "utf-8",
    );

    expect(() => load(prompt)).toThrow(/JavaScript frontmatter is not supported/);
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects file references that traverse outside the prompt directory", () => {
    const root = mkdtempSync(join(tmpdir(), "prompty-loader-"));
    const promptDir = join(root, "prompts");
    writeFileSync(join(root, "secret.txt"), "secret", "utf-8");
    writeFileSync(join(root, "marker"), "", "utf-8");
    mkdirSync(promptDir);
    const prompt = join(promptDir, "bad.prompty");
    writeFileSync(prompt, '---\nname: bad\ndescription: "${file:../secret.txt}"\n---\nHello\n', "utf-8");

    expect(() => load(prompt)).toThrow(/outside allowed roots/);
  });

  it("rejects absolute file references outside the prompt directory", () => {
    const root = mkdtempSync(join(tmpdir(), "prompty-loader-"));
    const promptDir = join(root, "prompts");
    mkdirSync(promptDir);
    const secret = join(root, "secret.txt");
    writeFileSync(secret, "secret", "utf-8");
    const prompt = join(promptDir, "bad.prompty");
    writeFileSync(
      prompt,
      `---\nname: bad\ndescription: "\${file:${secret.replaceAll("\\", "/")}}"\n---\nHello\n`,
      "utf-8",
    );

    expect(() => load(prompt)).toThrow(/outside allowed roots/);
  });

  it("allows file references outside the prompt directory when allowedFileRoots contains them", () => {
    const root = mkdtempSync(join(tmpdir(), "prompty-loader-"));
    const promptDir = join(root, "prompts");
    const sharedDir = join(root, "shared");
    mkdirSync(promptDir);
    mkdirSync(sharedDir);
    writeFileSync(join(sharedDir, "description.txt"), "shared description", "utf-8");
    const prompt = join(promptDir, "shared.prompty");
    writeFileSync(prompt, '---\nname: shared\ndescription: "${file:../shared/description.txt}"\n---\nHello\n', "utf-8");

    const agent = load(prompt, { allowedFileRoots: [sharedDir] });

    expect(agent.description).toBe("shared description");
  });

  it("rejects symlink escapes from the prompt directory", () => {
    const root = mkdtempSync(join(tmpdir(), "prompty-loader-"));
    const promptDir = join(root, "prompts");
    mkdirSync(promptDir);
    const secret = join(root, "secret.txt");
    writeFileSync(secret, "secret", "utf-8");
    try {
      symlinkSync(secret, join(promptDir, "secret-link.txt"));
    } catch {
      return;
    }
    const prompt = join(promptDir, "bad.prompty");
    writeFileSync(prompt, '---\nname: bad\ndescription: "${file:secret-link.txt}"\n---\nHello\n', "utf-8");

    expect(() => load(prompt)).toThrow(/outside allowed roots/);
  });

  it("loads chat prompty with inputs", () => {
    const agent = load(resolve(FIXTURES, "chat.prompty"));
    expect(agent.name).toBe("chat");
    expect(agent.inputs).toBeDefined();
    expect(agent.inputs!.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Structured output
  // -------------------------------------------------------------------------

  describe("structured output", () => {
    it("loads outputs as Property[]", () => {
      const agent = load(resolve(FIXTURES, "structured.prompty"));
      expect(agent.name).toBe("structured-output");
      expect(agent.outputs).toBeDefined();
      expect(agent.outputs!.length).toBe(3);
    });

    it("preserves output property kinds", () => {
      const agent = load(resolve(FIXTURES, "structured.prompty"));
      const byName = Object.fromEntries(agent.outputs!.map(p => [p.name, p]));
      expect(byName.summary.kind).toBe("string");
      expect(byName.keyPoints.kind).toBe("array");
      expect(byName.confidence.kind).toBe("number");
    });

    it("preserves output required flags", () => {
      const agent = load(resolve(FIXTURES, "structured.prompty"));
      const byName = Object.fromEntries(agent.outputs!.map(p => [p.name, p]));
      expect(byName.summary.required).toBe(true);
      expect(byName.keyPoints.required).toBe(true);
      // confidence has no explicit required — should be undefined or false
      expect(byName.confidence.required).toBeFalsy();
    });

    it("preserves output descriptions", () => {
      const agent = load(resolve(FIXTURES, "structured.prompty"));
      const byName = Object.fromEntries(agent.outputs!.map(p => [p.name, p]));
      expect(byName.summary.description).toBe("A brief summary");
      expect(byName.keyPoints.description).toBe("Key points about the topic");
    });
  });

  // -------------------------------------------------------------------------
  // Function tools
  // -------------------------------------------------------------------------

  describe("function tools", () => {
    it("loads tools as Tool[]", () => {
      const agent = load(resolve(FIXTURES, "tools.prompty"));
      expect(agent.name).toBe("tool-calling");
      expect(agent.tools).toBeDefined();
      expect(agent.tools!.length).toBe(1);
    });

    it("loads FunctionTool with correct name and description", () => {
      const agent = load(resolve(FIXTURES, "tools.prompty"));
      const tool = agent.tools![0];
      expect(tool.name).toBe("get_weather");
      expect(tool.kind).toBe("function");
      expect(tool.description).toBe("Get the current weather for a city");
    });

    it("loads FunctionTool parameters", () => {
      const agent = load(resolve(FIXTURES, "tools.prompty"));
      const tool = agent.tools![0] as { parameters?: unknown };
      expect(tool.parameters).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Agent mode
  // -------------------------------------------------------------------------

  describe("agent mode", () => {
    it("loads apiType as chat for agent prompts", () => {
      const agent = load(resolve(FIXTURES, "agent.prompty"));
      expect(agent.name).toBe("agent-loop");
      expect(agent.model.apiType).toBe("chat");
    });

    it("has tools defined for agent", () => {
      const agent = load(resolve(FIXTURES, "agent.prompty"));
      expect(agent.tools).toBeDefined();
      expect(agent.tools!.length).toBe(1);
      expect(agent.tools![0].name).toBe("get_weather");
    });
  });

  // -------------------------------------------------------------------------
  // Embedding
  // -------------------------------------------------------------------------

  describe("embedding", () => {
    it("loads apiType as embedding", () => {
      const agent = load(resolve(FIXTURES, "embedding.prompty"));
      expect(agent.name).toBe("embedding");
      expect(agent.model.apiType).toBe("embedding");
      expect(agent.model.id).toBe("text-embedding-3-small");
    });
  });

  // -------------------------------------------------------------------------
  // Image generation
  // -------------------------------------------------------------------------

  describe("image generation", () => {
    it("loads apiType as image", () => {
      const agent = load(resolve(FIXTURES, "image.prompty"));
      expect(agent.name).toBe("image-gen");
      expect(agent.model.apiType).toBe("image");
      expect(agent.model.id).toBe("dall-e-3");
    });

    it("loads model options with additionalProperties", () => {
      const agent = load(resolve(FIXTURES, "image.prompty"));
      const opts = agent.model.options;
      expect(opts).toBeDefined();
      expect(opts!.additionalProperties).toBeDefined();
      expect(opts!.additionalProperties!.size).toBe("1024x1024");
    });
  });
});

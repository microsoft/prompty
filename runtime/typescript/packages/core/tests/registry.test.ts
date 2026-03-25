import { describe, it, expect, beforeEach } from "vitest";
import {
  registerRenderer,
  registerParser,
  registerExecutor,
  registerProcessor,
  getRenderer,
  getParser,
  getExecutor,
  getProcessor,
  clearCache,
  InvokerError,
} from "../src/core/registry.js";
import type { Renderer, Parser, Executor, Processor } from "../src/core/interfaces.js";
import { Message } from "../src/core/types.js";
import type { Prompty } from "@prompty/core";

const mockRenderer: Renderer = {
  async render(_agent, template, inputs) {
    return template.replace("{{name}}", String(inputs.name ?? ""));
  },
};

const mockParser: Parser = {
  async parse(_agent, rendered) {
    return [new Message("user", [{ kind: "text", value: rendered }])];
  },
};

const mockExecutor: Executor = {
  async execute(_agent, messages) {
    return { choices: [{ message: { content: `Response to: ${messages[0]?.text}` } }] };
  },
};

const mockProcessor: Processor = {
  async process(_agent, response) {
    const r = response as Record<string, unknown>;
    const choices = r.choices as Record<string, unknown>[];
    const msg = choices[0].message as Record<string, unknown>;
    return msg.content;
  },
};

describe("Registry", () => {
  beforeEach(() => {
    clearCache();
  });

  it("registers and retrieves a renderer", () => {
    registerRenderer("test", mockRenderer);
    expect(getRenderer("test")).toBe(mockRenderer);
  });

  it("registers and retrieves a parser", () => {
    registerParser("test", mockParser);
    expect(getParser("test")).toBe(mockParser);
  });

  it("registers and retrieves an executor", () => {
    registerExecutor("test", mockExecutor);
    expect(getExecutor("test")).toBe(mockExecutor);
  });

  it("registers and retrieves a processor", () => {
    registerProcessor("test", mockProcessor);
    expect(getProcessor("test")).toBe(mockProcessor);
  });

  it("throws InvokerError for missing renderer", () => {
    expect(() => getRenderer("nonexistent")).toThrow(InvokerError);
  });

  it("throws InvokerError for missing parser", () => {
    expect(() => getParser("nonexistent")).toThrow(InvokerError);
  });

  it("throws InvokerError for missing executor", () => {
    expect(() => getExecutor("nonexistent")).toThrow(InvokerError);
  });

  it("throws InvokerError for missing processor", () => {
    expect(() => getProcessor("nonexistent")).toThrow(InvokerError);
  });

  it("clearCache removes all registrations", () => {
    registerRenderer("test", mockRenderer);
    registerParser("test", mockParser);
    clearCache();
    expect(() => getRenderer("test")).toThrow(InvokerError);
    expect(() => getParser("test")).toThrow(InvokerError);
  });
});

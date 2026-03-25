import { describe, it, expect, beforeEach } from "vitest";
import { messageToWire, buildChatArgs } from "../src/wire.js";
import { processResponse } from "../src/processor.js";
import { Message, text } from "@prompty/core";
import { Prompty } from "@prompty/core";

describe("messageToWire", () => {
  it("converts a simple text message", () => {
    const msg = new Message("user", [{ kind: "text", value: "Hello" }]);
    const wire = messageToWire(msg);
    expect(wire).toEqual({ role: "user", content: "Hello" });
  });

  it("converts a multimodal message", () => {
    const msg = new Message("user", [
      { kind: "text", value: "Look" },
      { kind: "image", source: "https://img.png" },
    ]);
    const wire = messageToWire(msg);
    expect(wire.role).toBe("user");
    expect(Array.isArray(wire.content)).toBe(true);
    const content = wire.content as Record<string, unknown>[];
    expect(content[0]).toEqual({ type: "text", text: "Look" });
    expect(content[1]).toHaveProperty("type", "image_url");
  });

  it("includes metadata as top-level keys", () => {
    const msg = new Message("tool", [text("result")], {
      tool_call_id: "call_123",
      name: "get_weather",
    });
    const wire = messageToWire(msg);
    expect(wire.tool_call_id).toBe("call_123");
    expect(wire.name).toBe("get_weather");
  });
});

describe("processResponse", () => {
  const agent = new Prompty({ name: "test", model: "gpt-4o" });

  it("extracts content from chat completion", () => {
    const response = {
      choices: [{ message: { content: "Hello!", role: "assistant" } }],
    };
    const result = processResponse(agent, response);
    expect(result).toBe("Hello!");
  });

  it("returns null for empty choices", () => {
    const response = { choices: [] };
    expect(processResponse(agent, response)).toBeNull();
  });

  it("extracts tool calls", () => {
    const response = {
      choices: [{
        message: {
          content: null,
          role: "assistant",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"location":"Seattle"}' },
          }],
        },
      }],
    };
    const result = processResponse(agent, response) as { id: string; name: string }[];
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("get_weather");
  });

  it("extracts embeddings", () => {
    const response = {
      object: "list",
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    };
    const result = processResponse(agent, response);
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("extracts image URLs", () => {
    const response = {
      data: [{ url: "https://example.com/image.png" }],
    };
    const result = processResponse(agent, response);
    expect(result).toBe("https://example.com/image.png");
  });
});

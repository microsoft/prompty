import { describe, it, expect, beforeEach } from "vitest";
import { messageToWire, buildChatArgs } from "../src/wire.js";
import { processResponse } from "../src/processor.js";
import { Message, text } from "@prompty/core";
import { Prompty } from "@prompty/core";

describe("messageToWire", () => {
  it("converts a simple text message", () => {
    const msg = new Message({ role: "user", parts: [{ kind: "text", value: "Hello" }] });
    const wire = messageToWire(msg);
    expect(wire).toEqual({ role: "user", content: "Hello" });
  });

  it("converts a multimodal message", () => {
    const msg = new Message({ role: "user", parts: [
      { kind: "text", value: "Look" },
      { kind: "image", source: "https://img.png" },
    ] });
    const wire = messageToWire(msg);
    expect(wire.role).toBe("user");
    expect(Array.isArray(wire.content)).toBe(true);
    const content = wire.content as Record<string, unknown>[];
    expect(content[0]).toEqual({ type: "text", text: "Look" });
    expect(content[1]).toHaveProperty("type", "image_url");
  });

  it("includes metadata as top-level keys", () => {
    const msg = new Message({ role: "tool", parts: [text("result")], metadata: {\r\n      tool_call_id: "call_123",\r\n      name: "get_weather",\r\n    } });
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

describe("buildChatArgs nested tool schemas", () => {
  it("produces array items with nested object properties", () => {
    const agent = Prompty.load({
      name: "test",
      model: {
        id: "gpt-4",
        provider: "openai",
        apiType: "chat",
        connection: { kind: "key", apiKey: "test-key" },
      },
      tools: [
        {
          name: "log_encounters",
          kind: "function",
          description: "Log encounters",
          parameters: [
            {
              name: "encounters",
              kind: "array",
              description: "List of encounters",
              items: {
                kind: "object",
                properties: [
                  { name: "title", kind: "string" },
                  { name: "difficulty", kind: "integer" },
                ],
              },
            },
          ],
        },
      ],
    });

    const msgs = [new Message({ role: "user", parts: [text("test")] })];
    const args = buildChatArgs(agent, msgs);
    const tools = args.tools as Record<string, unknown>[];
    expect(tools).toHaveLength(1);

    const func = (tools[0] as Record<string, unknown>).function as Record<string, unknown>;
    const params = func.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, Record<string, unknown>>;
    const encounters = props.encounters;

    expect(encounters.type).toBe("array");
    expect(encounters.items).toBeDefined();

    const items = encounters.items as Record<string, unknown>;
    expect(items.type).toBe("object");

    const itemProps = items.properties as Record<string, Record<string, unknown>>;
    expect(itemProps.title).toBeDefined();
    expect(itemProps.title.type).toBe("string");
    expect(itemProps.difficulty.type).toBe("integer");
    expect(items.additionalProperties).toBe(false);
  });

  it("produces nested object properties", () => {
    const agent = Prompty.load({
      name: "test",
      model: { id: "gpt-4", provider: "openai" },
      tools: [
        {
          name: "save",
          kind: "function",
          parameters: [
            {
              name: "idea",
              kind: "object",
              properties: [
                { name: "name", kind: "string" },
                { name: "description", kind: "string" },
              ],
            },
          ],
        },
      ],
    });

    const msgs = [new Message({ role: "user", parts: [text("test")] })];
    const args = buildChatArgs(agent, msgs);
    const tools = args.tools as Record<string, unknown>[];
    const func = (tools[0] as Record<string, unknown>).function as Record<string, unknown>;
    const params = func.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, Record<string, unknown>>;
    const idea = props.idea;

    expect(idea.type).toBe("object");
    const nested = idea.properties as Record<string, Record<string, unknown>>;
    expect(nested.name.type).toBe("string");
    expect(nested.description.type).toBe("string");
    expect(idea.additionalProperties).toBe(false);
  });

  it("handles deeply nested schemas (array > object > array > string)", () => {
    const agent = Prompty.load({
      name: "test",
      model: { id: "gpt-4", provider: "openai" },
      tools: [
        {
          name: "deep",
          kind: "function",
          parameters: [
            {
              name: "chapters",
              kind: "array",
              items: {
                kind: "object",
                properties: [
                  { name: "title", kind: "string" },
                  {
                    name: "tags",
                    kind: "array",
                    items: { kind: "string" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const msgs = [new Message({ role: "user", parts: [text("test")] })];
    const args = buildChatArgs(agent, msgs);
    const tools = args.tools as Record<string, unknown>[];
    const func = (tools[0] as Record<string, unknown>).function as Record<string, unknown>;
    const params = func.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, Record<string, unknown>>;
    const chapters = props.chapters;

    expect(chapters.type).toBe("array");
    const itemSchema = chapters.items as Record<string, unknown>;
    expect(itemSchema.type).toBe("object");

    const chapterProps = itemSchema.properties as Record<string, Record<string, unknown>>;
    expect(chapterProps.tags.type).toBe("array");
    const tagItems = chapterProps.tags.items as Record<string, unknown>;
    expect(tagItems.type).toBe("string");
  });
});

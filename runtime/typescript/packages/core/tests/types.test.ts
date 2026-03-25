import { describe, it, expect } from "vitest";
import {
  Message,
  ThreadMarker,
  text,
  textMessage,
  dictToMessage,
  dictContentToPart,
  RICH_KINDS,
  ROLES,
} from "../src/core/types.js";

describe("Message", () => {
  it("creates a message with text parts", () => {
    const msg = new Message("user", [{ kind: "text", value: "Hello" }]);
    expect(msg.role).toBe("user");
    expect(msg.text).toBe("Hello");
    expect(msg.parts).toHaveLength(1);
  });

  it("concatenates multiple text parts", () => {
    const msg = new Message("user", [
      { kind: "text", value: "Hello " },
      { kind: "text", value: "world" },
    ]);
    expect(msg.text).toBe("Hello world");
  });

  it("returns string for single text part in toTextContent", () => {
    const msg = new Message("user", [{ kind: "text", value: "Hello" }]);
    expect(msg.toTextContent()).toBe("Hello");
  });

  it("returns array for multimodal content in toTextContent", () => {
    const msg = new Message("user", [
      { kind: "text", value: "Look at this" },
      { kind: "image", source: "https://example.com/img.png" },
    ]);
    const content = msg.toTextContent();
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
  });

  it("defaults to empty parts and metadata", () => {
    const msg = new Message("system");
    expect(msg.parts).toEqual([]);
    expect(msg.metadata).toEqual({});
  });
});

describe("ThreadMarker", () => {
  it("stores a name", () => {
    const marker = new ThreadMarker("history");
    expect(marker.name).toBe("history");
  });
});

describe("text helper", () => {
  it("creates a TextPart", () => {
    const part = text("hello");
    expect(part).toEqual({ kind: "text", value: "hello" });
  });
});

describe("textMessage helper", () => {
  it("creates a Message with one text part", () => {
    const msg = textMessage("user", "Hello");
    expect(msg.role).toBe("user");
    expect(msg.text).toBe("Hello");
    expect(msg.parts).toHaveLength(1);
  });
});

describe("dictToMessage", () => {
  it("converts a simple dict", () => {
    const msg = dictToMessage({ role: "user", content: "Hi" });
    expect(msg.role).toBe("user");
    expect(msg.text).toBe("Hi");
  });

  it("preserves metadata", () => {
    const msg = dictToMessage({ role: "tool", content: "result", tool_call_id: "123" });
    expect(msg.metadata.tool_call_id).toBe("123");
  });

  it("handles array content", () => {
    const msg = dictToMessage({
      role: "user",
      content: [
        { type: "text", text: "Hello" },
        { type: "image_url", image_url: { url: "https://img.png" } },
      ],
    });
    expect(msg.parts).toHaveLength(2);
    expect(msg.parts[0].kind).toBe("text");
    expect(msg.parts[1].kind).toBe("image");
  });
});

describe("dictContentToPart", () => {
  it("converts text type", () => {
    const part = dictContentToPart({ type: "text", text: "hello" });
    expect(part).toEqual({ kind: "text", value: "hello" });
  });

  it("converts image_url type", () => {
    const part = dictContentToPart({ type: "image_url", image_url: { url: "https://img.png" } });
    expect(part.kind).toBe("image");
    if (part.kind === "image") {
      expect(part.source).toBe("https://img.png");
    }
  });
});

describe("constants", () => {
  it("RICH_KINDS contains expected values", () => {
    expect(RICH_KINDS.has("thread")).toBe(true);
    expect(RICH_KINDS.has("image")).toBe(true);
    expect(RICH_KINDS.has("file")).toBe(true);
    expect(RICH_KINDS.has("audio")).toBe(true);
    expect(RICH_KINDS.has("string")).toBe(false);
  });

  it("ROLES contains expected values", () => {
    expect(ROLES.has("system")).toBe(true);
    expect(ROLES.has("user")).toBe(true);
    expect(ROLES.has("assistant")).toBe(true);
    expect(ROLES.has("developer")).toBe(true);
    expect(ROLES.has("tool")).toBe(true);
  });
});

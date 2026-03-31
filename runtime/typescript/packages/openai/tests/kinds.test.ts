import { describe, it, expect } from "vitest";
import { buildChatArgs, buildEmbeddingArgs, buildImageArgs, buildResponsesArgs } from "../src/wire.js";
import { processResponse } from "../src/processor.js";
import {
  Prompty,
  Model,
  ModelOptions,
  ApiKeyConnection,
  Property,
  FunctionTool,
  Message,
  text,
} from "@prompty/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides?: {
  name?: string;
  apiType?: string;
  modelId?: string;
  options?: Record<string, unknown>;
  tools?: unknown[];
  outputs?: unknown[];
}): Prompty {
  const opts = overrides?.options
    ? new ModelOptions(overrides.options as Partial<ModelOptions>)
    : undefined;

  return new Prompty({
    name: overrides?.name ?? "test",
    instructions: "system:\nYou are helpful.\n\nuser:\n{{question}}",
    model: new Model({
      id: overrides?.modelId ?? "gpt-4o",
      provider: "openai",
      apiType: overrides?.apiType ?? "chat",
      connection: new ApiKeyConnection({
        kind: "key",
        apiKey: "test-key",
        endpoint: "https://api.openai.com/v1",
      }),
      options: opts,
    }),
    tools: overrides?.tools as Prompty["tools"],
    outputs: overrides?.outputs as Prompty["outputs"],
  });
}

// ===========================================================================
// buildChatArgs
// ===========================================================================

describe("buildChatArgs", () => {
  it("produces model and messages", () => {
    const agent = makeAgent();
    const msgs = [new Message("user", [text("Hello")])];
    const args = buildChatArgs(agent, msgs);

    expect(args.model).toBe("gpt-4o");
    expect(args.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("includes temperature and other options", () => {
    const agent = makeAgent({ options: { temperature: 0.5, topP: 0.9, seed: 42 } });
    const args = buildChatArgs(agent, []);

    expect(args.temperature).toBe(0.5);
    expect(args.top_p).toBe(0.9);
    expect(args.seed).toBe(42);
  });

  it("maps maxOutputTokens to max_completion_tokens", () => {
    const agent = makeAgent({ options: { maxOutputTokens: 1000 } });
    const args = buildChatArgs(agent, []);

    expect(args.max_completion_tokens).toBe(1000);
    expect(args.max_tokens).toBeUndefined();
  });

  it("maps stopSequences to stop", () => {
    const agent = makeAgent({ options: { stopSequences: ["END", "STOP"] } });
    const args = buildChatArgs(agent, []);

    expect(args.stop).toEqual(["END", "STOP"]);
  });

  it("maps frequencyPenalty and presencePenalty", () => {
    const agent = makeAgent({ options: { frequencyPenalty: 0.5, presencePenalty: 0.3 } });
    const args = buildChatArgs(agent, []);

    expect(args.frequency_penalty).toBe(0.5);
    expect(args.presence_penalty).toBe(0.3);
  });

  it("passes additionalProperties without overwriting mapped keys", () => {
    const agent = makeAgent({
      options: {
        temperature: 0.7,
        additionalProperties: {
          temperature: 999,  // should NOT overwrite
          response_format: { type: "json_object" },  // should pass through
        },
      },
    });
    const args = buildChatArgs(agent, []);

    expect(args.temperature).toBe(0.7);
    expect(args.response_format).toEqual({ type: "json_object" });
  });

  it("falls back to gpt-4 when model id is empty", () => {
    const agent = new Prompty({ name: "test", model: new Model({}) });
    const args = buildChatArgs(agent, []);
    expect(args.model).toBe("gpt-4");
  });
});

// ===========================================================================
// buildChatArgs — tools
// ===========================================================================

describe("buildChatArgs tools", () => {
  it("includes function tools in wire format", () => {
    const tool = new FunctionTool({
      name: "get_weather",
      kind: "function",
      description: "Get the weather",
      parameters: [
        new Property({ name: "city", kind: "string", description: "City name", required: true }),
        new Property({ name: "unit", kind: "string", description: "Unit" }),
      ],
    });
    const agent = makeAgent({ tools: [tool] });
    const args = buildChatArgs(agent, []);

    expect(args.tools).toBeDefined();
    const tools = args.tools as Record<string, unknown>[];
    expect(tools.length).toBe(1);
    expect(tools[0].type).toBe("function");

    const fn = tools[0].function as Record<string, unknown>;
    expect(fn.name).toBe("get_weather");
    expect(fn.description).toBe("Get the weather");

    const params = fn.parameters as Record<string, unknown>;
    expect(params.type).toBe("object");
    const props = params.properties as Record<string, unknown>;
    expect(props.city).toEqual({ type: "string", description: "City name" });
    expect(props.unit).toEqual({ type: "string", description: "Unit" });
    expect(params.required).toEqual(["city"]);
  });

  it("omits tools when none are defined", () => {
    const agent = makeAgent();
    const args = buildChatArgs(agent, []);
    expect(args.tools).toBeUndefined();
  });

  it("omits description when not set", () => {
    const tool = new FunctionTool({
      name: "ping",
      kind: "function",
    });
    const agent = makeAgent({ tools: [tool] });
    const args = buildChatArgs(agent, []);

    const tools = args.tools as Record<string, unknown>[];
    const fn = tools[0].function as Record<string, unknown>;
    expect(fn.description).toBeUndefined();
  });
});

// ===========================================================================
// buildChatArgs — structured output (response_format)
// ===========================================================================

describe("buildChatArgs structured output", () => {
  it("generates response_format from outputSchema", () => {
    const agent = makeAgent({
      name: "my-research-agent",
      outputs: [
        new Property({ name: "summary", kind: "string", description: "A summary", required: true }),
        new Property({ name: "score", kind: "float", required: true }),
      ],
    });
    const args = buildChatArgs(agent, []);

    expect(args.response_format).toBeDefined();
    const rf = args.response_format as Record<string, unknown>;
    expect(rf.type).toBe("json_schema");

    const jsonSchema = rf.json_schema as Record<string, unknown>;
    expect(jsonSchema.name).toBe("my_research_agent");
    expect(jsonSchema.strict).toBe(true);

    const inner = jsonSchema.schema as Record<string, unknown>;
    expect(inner.type).toBe("object");
    expect(inner.additionalProperties).toBe(false);

    const props = inner.properties as Record<string, unknown>;
    expect(props.summary).toEqual({ type: "string", description: "A summary" });
    expect(props.score).toEqual({ type: "number" });

    // All outputs are marked required
    const req = inner.required as string[];
    expect(req).toContain("summary");
    expect(req).toContain("score");
  });

  it("maps kind correctly to JSON Schema types", () => {
    const agent = makeAgent({
      outputs: [
        new Property({ name: "a", kind: "string" }),
        new Property({ name: "b", kind: "integer" }),
        new Property({ name: "c", kind: "float" }),
        new Property({ name: "d", kind: "number" }),
        new Property({ name: "e", kind: "boolean" }),
        new Property({ name: "f", kind: "array" }),
        new Property({ name: "g", kind: "object" }),
      ],
    });
    const args = buildChatArgs(agent, []);
    const rf = args.response_format as Record<string, unknown>;
    const schema = (rf.json_schema as Record<string, unknown>).schema as Record<string, unknown>;
    const props = schema.properties as Record<string, { type: string }>;

    expect(props.a.type).toBe("string");
    expect(props.b.type).toBe("integer");
    expect(props.c.type).toBe("number");
    expect(props.d.type).toBe("number");
    expect(props.e.type).toBe("boolean");
    expect(props.f.type).toBe("array");
    expect(props.g.type).toBe("object");
  });

  it("omits response_format when no outputs defined", () => {
    const agent = makeAgent();
    const args = buildChatArgs(agent, []);
    expect(args.response_format).toBeUndefined();
  });
});

// ===========================================================================
// buildEmbeddingArgs
// ===========================================================================

describe("buildEmbeddingArgs", () => {
  it("wraps a single string into input array", () => {
    const agent = makeAgent({ apiType: "embedding", modelId: "text-embedding-3-small" });
    const args = buildEmbeddingArgs(agent, "Hello world");

    expect(args.model).toBe("text-embedding-3-small");
    expect(args.input).toEqual(["Hello world"]);
  });

  it("passes array input through", () => {
    const agent = makeAgent({ apiType: "embedding" });
    const args = buildEmbeddingArgs(agent, ["one", "two", "three"]);
    expect(args.input).toEqual(["one", "two", "three"]);
  });

  it("defaults model when id is empty", () => {
    const agent = new Prompty({ name: "test", model: new Model({}) });
    const args = buildEmbeddingArgs(agent, "test");
    expect(args.model).toBe("text-embedding-ada-002");
  });

  it("does NOT include chat options like temperature", () => {
    const agent = makeAgent({
      apiType: "embedding",
      modelId: "text-embedding-3-small",
      options: { temperature: 0.5 },
    });
    const args = buildEmbeddingArgs(agent, "test");
    expect(args.temperature).toBeUndefined();
  });

  it("passes additionalProperties through", () => {
    const agent = makeAgent({
      apiType: "embedding",
      modelId: "text-embedding-3-small",
      options: { additionalProperties: { dimensions: 256 } },
    });
    const args = buildEmbeddingArgs(agent, "test");
    expect(args.dimensions).toBe(256);
  });
});

// ===========================================================================
// buildImageArgs
// ===========================================================================

describe("buildImageArgs", () => {
  it("passes prompt as string", () => {
    const agent = makeAgent({ apiType: "image", modelId: "dall-e-3" });
    const args = buildImageArgs(agent, "A cute cat");

    expect(args.model).toBe("dall-e-3");
    expect(args.prompt).toBe("A cute cat");
  });

  it("converts non-string to string", () => {
    const agent = makeAgent({ apiType: "image" });
    const args = buildImageArgs(agent, 42);
    expect(args.prompt).toBe("42");
  });

  it("does NOT include chat options like temperature", () => {
    const agent = makeAgent({
      apiType: "image",
      modelId: "dall-e-3",
      options: { temperature: 0.5, topP: 0.9 },
    });
    const args = buildImageArgs(agent, "A cat");
    expect(args.temperature).toBeUndefined();
    expect(args.top_p).toBeUndefined();
  });

  it("passes additionalProperties through", () => {
    const agent = makeAgent({
      apiType: "image",
      modelId: "dall-e-3",
      options: { additionalProperties: { size: "1024x1024", quality: "standard" } },
    });
    const args = buildImageArgs(agent, "A cat");
    expect(args.size).toBe("1024x1024");
    expect(args.quality).toBe("standard");
  });
});

// ===========================================================================
// processResponse — structured output
// ===========================================================================

describe("processResponse structured output", () => {
  it("JSON-parses content when outputs exist", () => {
    const agent = makeAgent({
      outputs: [
        new Property({ name: "answer", kind: "string", required: true }),
        new Property({ name: "confidence", kind: "number", required: true }),
      ],
    });
    const response = {
      choices: [{
        message: {
          role: "assistant",
          content: '{"answer":"42","confidence":0.95}',
        },
      }],
    };

    const result = processResponse(agent, response);
    expect(result).toEqual({ answer: "42", confidence: 0.95 });
  });

  it("returns raw string if JSON parse fails", () => {
    const agent = makeAgent({
      outputs: [new Property({ name: "answer", kind: "string" })],
    });
    const response = {
      choices: [{ message: { role: "assistant", content: "not valid json" } }],
    };

    const result = processResponse(agent, response);
    expect(result).toBe("not valid json");
  });

  it("returns plain string when no outputs defined", () => {
    const agent = makeAgent();
    const response = {
      choices: [{
        message: {
          role: "assistant",
          content: '{"answer":"42"}',
        },
      }],
    };

    const result = processResponse(agent, response);
    expect(result).toBe('{"answer":"42"}');
  });
});

// ===========================================================================
// processResponse — tool calls
// ===========================================================================

describe("processResponse tool calls", () => {
  it("extracts tool call list from response", () => {
    const agent = makeAgent();
    const response = {
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"Seattle"}' },
            },
          ],
        },
      }],
    };

    const result = processResponse(agent, response) as { id: string; name: string; arguments: string }[];
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("call_abc");
    expect(result[0].name).toBe("get_weather");
    expect(result[0].arguments).toBe('{"city":"Seattle"}');
  });

  it("extracts multiple tool calls", () => {
    const agent = makeAgent();
    const response = {
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Seattle"}' } },
            { id: "call_2", type: "function", function: { name: "get_time", arguments: '{"zone":"PST"}' } },
          ],
        },
      }],
    };

    const result = processResponse(agent, response) as unknown[];
    expect(result).toHaveLength(2);
  });
});

// ===========================================================================
// processResponse — embeddings
// ===========================================================================

describe("processResponse embeddings", () => {
  it("extracts single embedding vector", () => {
    const agent = makeAgent({ apiType: "embedding" });
    const response = {
      object: "list",
      data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }],
    };

    const result = processResponse(agent, response);
    expect(result).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("extracts batch embedding vectors", () => {
    const agent = makeAgent({ apiType: "embedding" });
    const response = {
      object: "list",
      data: [
        { embedding: [0.1, 0.2] },
        { embedding: [0.3, 0.4] },
      ],
    };

    const result = processResponse(agent, response);
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });
});

// ===========================================================================
// processResponse — image generation
// ===========================================================================

describe("processResponse images", () => {
  it("extracts single image URL", () => {
    const agent = makeAgent({ apiType: "image" });
    const response = {
      data: [{ url: "https://example.com/cat.png" }],
    };

    const result = processResponse(agent, response);
    expect(result).toBe("https://example.com/cat.png");
  });

  it("extracts base64 image when no URL", () => {
    const agent = makeAgent({ apiType: "image" });
    const response = {
      data: [{ b64_json: "iVBORw0KGgo..." }],
    };

    const result = processResponse(agent, response);
    expect(result).toBe("iVBORw0KGgo...");
  });

  it("extracts multiple images", () => {
    const agent = makeAgent({ apiType: "image" });
    const response = {
      data: [
        { url: "https://example.com/cat1.png" },
        { url: "https://example.com/cat2.png" },
      ],
    };

    const result = processResponse(agent, response) as string[];
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("https://example.com/cat1.png");
  });
});

// ===========================================================================
// processResponse — edge cases
// ===========================================================================

describe("processResponse edge cases", () => {
  it("returns null for empty choices", () => {
    const agent = makeAgent();
    expect(processResponse(agent, { choices: [] })).toBeNull();
  });

  it("returns null for missing message", () => {
    const agent = makeAgent();
    expect(processResponse(agent, { choices: [{}] })).toBeNull();
  });

  it("returns raw response for unknown shape", () => {
    const agent = makeAgent();
    const response = { unknown: "data" };
    expect(processResponse(agent, response)).toEqual({ unknown: "data" });
  });

  it("passes through non-object response", () => {
    const agent = makeAgent();
    expect(processResponse(agent, "just a string")).toBe("just a string");
    expect(processResponse(agent, null)).toBeNull();
    expect(processResponse(agent, 42)).toBe(42);
  });
});

// ===========================================================================
// buildResponsesArgs
// ===========================================================================

describe("buildResponsesArgs", () => {
  it("separates system messages into instructions", () => {
    const agent = makeAgent({ apiType: "responses" });
    const msgs = [
      new Message("system", [text("You are helpful.")]),
      new Message("user", [text("Hello")]),
    ];
    const args = buildResponsesArgs(agent, msgs);

    expect(args.instructions).toBe("You are helpful.");
    expect(args.input).toEqual([{ role: "user", content: "Hello" }]);
    expect(args.model).toBe("gpt-4o");
  });

  it("maps maxOutputTokens to max_output_tokens (not max_completion_tokens)", () => {
    const agent = makeAgent({ apiType: "responses", options: { maxOutputTokens: 500 } });
    const args = buildResponsesArgs(agent, []);

    expect(args.max_output_tokens).toBe(500);
    expect(args.max_completion_tokens).toBeUndefined();
  });

  it("maps temperature and topP", () => {
    const agent = makeAgent({ apiType: "responses", options: { temperature: 0.7, topP: 0.9 } });
    const args = buildResponsesArgs(agent, []);

    expect(args.temperature).toBe(0.7);
    expect(args.top_p).toBe(0.9);
  });

  it("does NOT include frequency_penalty/presence_penalty", () => {
    const agent = makeAgent({
      apiType: "responses",
      options: { frequencyPenalty: 0.5, presencePenalty: 0.5 },
    });
    const args = buildResponsesArgs(agent, []);

    expect(args.frequency_penalty).toBeUndefined();
    expect(args.presence_penalty).toBeUndefined();
  });

  it("passes additionalProperties through", () => {
    const agent = makeAgent({
      apiType: "responses",
      options: { additionalProperties: { store: true, previous_response_id: "resp_123" } },
    });
    const args = buildResponsesArgs(agent, []);

    expect(args.store).toBe(true);
    expect(args.previous_response_id).toBe("resp_123");
  });

  it("uses flat tool format (not nested function:)", () => {
    const agent = makeAgent({
      apiType: "responses",
      tools: [
        new FunctionTool({
          name: "get_weather",
          kind: "function",
          description: "Get weather",
          parameters: [
            new Property({ name: "city", kind: "string", required: true }),
          ] as FunctionTool["parameters"],
        }),
      ],
    });
    const args = buildResponsesArgs(agent, []);

    const tools = args.tools as Record<string, unknown>[];
    expect(tools.length).toBe(1);
    expect(tools[0].type).toBe("function");
    expect(tools[0].name).toBe("get_weather");
    // Flat format — no `function:` wrapper
    expect(tools[0].function).toBeUndefined();
    expect(tools[0].parameters).toBeDefined();
  });

  it("uses text.format for structured output (not response_format)", () => {
    const agent = makeAgent({
      name: "test_structured",
      apiType: "responses",
      outputs: [
        new Property({ name: "summary", kind: "string" }),
        new Property({ name: "score", kind: "integer" }),
      ],
    });
    const args = buildResponsesArgs(agent, []);

    expect(args.response_format).toBeUndefined();
    expect(args.text).toBeDefined();
    const textConfig = args.text as Record<string, unknown>;
    const format = textConfig.format as Record<string, unknown>;
    expect(format.type).toBe("json_schema");
    expect(format.name).toBe("test_structured");
    expect(format.strict).toBe(true);
    expect(format.schema).toBeDefined();
  });

  it("combines multiple system messages", () => {
    const agent = makeAgent({ apiType: "responses" });
    const msgs = [
      new Message("system", [text("Rule 1.")]),
      new Message("developer", [text("Rule 2.")]),
      new Message("user", [text("Hello")]),
    ];
    const args = buildResponsesArgs(agent, msgs);

    expect(args.instructions).toBe("Rule 1.\n\nRule 2.");
    expect((args.input as unknown[]).length).toBe(1);
  });

  it("converts tool result messages to function_call_output", () => {
    const agent = makeAgent({ apiType: "responses" });
    const msgs = [
      new Message("tool", [text("72°F")], { tool_call_id: "call_123" }),
    ];
    const args = buildResponsesArgs(agent, msgs);

    const input = args.input as Record<string, unknown>[];
    expect(input.length).toBe(1);
    expect(input[0].type).toBe("function_call_output");
    expect(input[0].call_id).toBe("call_123");
    expect(input[0].output).toBe("72°F");
  });
});

// ===========================================================================
// processResponse — Responses API
// ===========================================================================

describe("processResponse Responses API", () => {
  it("extracts text from output_text", () => {
    const agent = makeAgent({ apiType: "responses" });
    const response = {
      object: "response",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Hello!" }],
        },
      ],
      output_text: "Hello!",
    };
    expect(processResponse(agent, response)).toBe("Hello!");
  });

  it("extracts function tool calls", () => {
    const agent = makeAgent({ apiType: "responses" });
    const response = {
      object: "response",
      output: [
        {
          type: "function_call",
          call_id: "call_abc",
          name: "get_weather",
          arguments: '{"city":"NYC"}',
        },
      ],
    };
    const result = processResponse(agent, response) as { id: string; name: string; arguments: string }[];
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("call_abc");
    expect(result[0].name).toBe("get_weather");
    expect(result[0].arguments).toBe('{"city":"NYC"}');
  });

  it("JSON-parses structured output from Responses API", () => {
    const agent = makeAgent({
      apiType: "responses",
      outputs: [
        new Property({ name: "summary", kind: "string" }),
        new Property({ name: "score", kind: "integer" }),
      ],
    });
    const response = {
      object: "response",
      output: [
        { type: "message", content: [{ type: "output_text", text: '{"summary":"test","score":5}' }] },
      ],
      output_text: '{"summary":"test","score":5}',
    };
    expect(processResponse(agent, response)).toEqual({ summary: "test", score: 5 });
  });

  it("falls back to message content when output_text is absent", () => {
    const agent = makeAgent({ apiType: "responses" });
    const response = {
      object: "response",
      output: [
        { type: "message", content: [{ type: "output_text", text: "Fallback text" }] },
      ],
    };
    expect(processResponse(agent, response)).toBe("Fallback text");
  });
});

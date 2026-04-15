import { describe, it, expect, beforeEach } from "vitest";
import {
  invoke,
  run,
  process,
} from "../src/core/pipeline.js";
import {
  registerRenderer,
  registerParser,
  registerExecutor,
  registerProcessor,
} from "../src/core/registry.js";
import { Message, text } from "../src/core/types.js";
import { Prompty, Property } from "@prompty/core";
import type { Renderer, Parser, Executor, Processor } from "../src/core/interfaces.js";
import {
  createStructuredResult,
  isStructuredResult,
  StructuredResultSymbol,
  cast,
} from "../src/core/structured.js";

// ---------------------------------------------------------------------------
// Test data: the structured JSON an LLM would return
// ---------------------------------------------------------------------------

const WEATHER_JSON = '{"city":"Seattle","temperature":72.5,"unit":"F"}';
const WEATHER_DATA = { city: "Seattle", temperature: 72.5, unit: "F" };

const PERSON_JSON = '{"name":"Jane","age":30,"email":"jane@example.com"}';
const PERSON_DATA = { name: "Jane", age: 30, email: "jane@example.com" };

// ---------------------------------------------------------------------------
// Mock implementations that simulate real providers returning structured output
// ---------------------------------------------------------------------------

class MockRenderer implements Renderer {
  async render(_agent: Prompty, template: string, inputs: Record<string, unknown>): Promise<string> {
    let result = template;
    for (const [key, val] of Object.entries(inputs)) {
      result = result.replace(`{{${key}}}`, String(val));
    }
    return result;
  }
}

class MockParser implements Parser {
  async parse(_agent: Prompty, rendered: string): Promise<Message[]> {
    return [new Message("user", [text(rendered)])];
  }
}

/**
 * Mock executor that returns a raw LLM response envelope containing
 * structured JSON in the content field — mimicking what OpenAI returns
 * when response_format is set.
 */
class StructuredExecutor implements Executor {
  constructor(private jsonContent: string = WEATHER_JSON) {}

  async execute(_agent: Prompty, _messages: Message[]): Promise<unknown> {
    return {
      choices: [{
        message: {
          role: "assistant",
          content: this.jsonContent,
        },
        finish_reason: "stop",
      }],
    };
  }

  formatToolMessages(
    _rawResponse: unknown,
    toolCalls: { id: string; name: string; arguments: string }[],
    toolResults: string[],
    textContent = "",
  ): Message[] {
    const messages: Message[] = [];
    const rawToolCalls = toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    }));
    messages.push(
      new Message("assistant", textContent ? [text(textContent)] : [], {
        tool_calls: rawToolCalls,
      }),
    );
    for (let i = 0; i < toolCalls.length; i++) {
      messages.push(
        new Message("tool", [text(toolResults[i])], {
          tool_call_id: toolCalls[i].id,
          name: toolCalls[i].name,
        }),
      );
    }
    return messages;
  }
}

/**
 * Mock processor that behaves like real OpenAI/Anthropic processors:
 * extracts content from the LLM response envelope and wraps structured
 * JSON in a StructuredResult when the agent has outputs defined.
 */
class StructuredProcessor implements Processor {
  async process(agent: Prompty, response: unknown): Promise<unknown> {
    const r = response as Record<string, unknown>;
    const choices = r.choices as Record<string, unknown>[];
    const msg = choices[0].message as Record<string, unknown>;
    const content = msg.content as string;

    // Mirror real processor behavior: when agent has outputs, wrap in StructuredResult
    if (agent.outputs && agent.outputs.length > 0) {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return createStructuredResult(parsed, content);
    }

    return content;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStructuredAgent(overrides?: {
  name?: string;
  instructions?: string;
  jsonContent?: string;
}): Prompty {
  const agent = new Prompty({
    name: overrides?.name ?? "structured-test",
    instructions: overrides?.instructions ?? "Return weather data for {{city}}.",
    outputs: [
      new Property({ name: "city", kind: "string", description: "City name" }),
      new Property({ name: "temperature", kind: "float", description: "Temperature value" }),
      new Property({ name: "unit", kind: "string", description: "Temperature unit" }),
    ],
  });
  agent.template = { format: { kind: "struct-mock" }, parser: { kind: "struct-mock" } } as any;
  (agent as any).model = { provider: "struct-mock" };
  return agent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Structured output through pipeline", () => {
  beforeEach(() => {
    registerRenderer("struct-mock", new MockRenderer());
    registerParser("struct-mock", new MockParser());
    registerExecutor("struct-mock", new StructuredExecutor(WEATHER_JSON));
    registerProcessor("struct-mock", new StructuredProcessor());
  });

  // -------------------------------------------------------------------------
  // invoke()
  // -------------------------------------------------------------------------

  describe("invoke() with structured output", () => {
    it("returns a StructuredResult with expected data fields", async () => {
      const agent = makeStructuredAgent();
      const result = await invoke(agent, { city: "Seattle" });

      // The result should be a StructuredResult — not a raw envelope
      expect(isStructuredResult(result)).toBe(true);

      // Data fields are directly accessible (no .choices[0].message wrapper)
      const sr = result as Record<string, unknown>;
      expect(sr.city).toBe("Seattle");
      expect(sr.temperature).toBe(72.5);
      expect(sr.unit).toBe("F");
    });

    it("StructuredResult carries raw JSON via symbol", async () => {
      const agent = makeStructuredAgent();
      const result = await invoke(agent, { city: "Seattle" });

      expect(isStructuredResult(result)).toBe(true);
      const sr = result as any;
      expect(sr[StructuredResultSymbol]).toBe(WEATHER_JSON);
    });

    it("StructuredResult symbol is not enumerable — clean serialization", async () => {
      const agent = makeStructuredAgent();
      const result = await invoke(agent, { city: "Seattle" });

      // Object.keys and JSON.stringify should not include the symbol
      const keys = Object.keys(result as object);
      expect(keys).toEqual(["city", "temperature", "unit"]);
      expect(JSON.stringify(result)).toBe(WEATHER_JSON);
    });

    it("cast<T>() works on invoke() result", async () => {
      const agent = makeStructuredAgent();
      const result = await invoke(agent, { city: "Seattle" });

      interface Weather {
        city: string;
        temperature: number;
        unit: string;
      }
      const weather = cast<Weather>(result);
      expect(weather.city).toBe("Seattle");
      expect(weather.temperature).toBe(72.5);
      expect(weather.unit).toBe("F");
    });

    it("invoke() with validator returns typed result directly", async () => {
      const agent = makeStructuredAgent();

      interface Weather {
        city: string;
        temperature: number;
        unit: string;
      }
      const weather = await invoke<Weather>(agent, { city: "Seattle" }, {
        validator: (data: unknown) => {
          const d = data as Weather;
          if (typeof d.city !== "string") throw new Error("city must be string");
          return d;
        },
      });

      expect(weather.city).toBe("Seattle");
      expect(weather.temperature).toBe(72.5);
    });

    it("returns plain string when agent has no outputs", async () => {
      // Agent without outputs — processor returns raw string content
      const agent = new Prompty({
        name: "no-outputs",
        instructions: "Hello {{name}}",
      });
      agent.template = { format: { kind: "struct-mock" }, parser: { kind: "struct-mock" } } as any;
      (agent as any).model = { provider: "struct-mock" };

      const result = await invoke(agent, { name: "World" });
      // Without outputs, processor returns the raw content string
      expect(typeof result).toBe("string");
      expect(isStructuredResult(result)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // run()
  // -------------------------------------------------------------------------

  describe("run() with structured output", () => {
    it("returns a StructuredResult with accessible data fields", async () => {
      const agent = makeStructuredAgent();
      const messages = [new Message("user", [text("What is the weather?")])];

      const result = await run(agent, messages);

      expect(isStructuredResult(result)).toBe(true);
      const sr = result as Record<string, unknown>;
      expect(sr.city).toBe("Seattle");
      expect(sr.temperature).toBe(72.5);
      expect(sr.unit).toBe("F");
    });

    it("cast<T>() works on run() result", async () => {
      const agent = makeStructuredAgent();
      const messages = [new Message("user", [text("What is the weather?")])];

      const result = await run(agent, messages);

      interface Weather {
        city: string;
        temperature: number;
        unit: string;
      }
      const weather = cast<Weather>(result);
      expect(weather.city).toBe("Seattle");
      expect(weather.temperature).toBe(72.5);
    });

    it("run() with raw=true returns executor envelope, not StructuredResult", async () => {
      const agent = makeStructuredAgent();
      const messages = [new Message("user", [text("What is the weather?")])];

      const result = await run(agent, messages, { raw: true }) as Record<string, unknown>;

      // Raw mode skips the processor — returns the executor's raw response
      expect(isStructuredResult(result)).toBe(false);
      expect(result.choices).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // process()
  // -------------------------------------------------------------------------

  describe("process() with structured output", () => {
    it("wraps structured JSON in StructuredResult when agent has outputs", async () => {
      const agent = makeStructuredAgent();
      const rawResponse = {
        choices: [{ message: { role: "assistant", content: WEATHER_JSON } }],
      };

      const result = await process(agent, rawResponse);

      expect(isStructuredResult(result)).toBe(true);
      const sr = result as Record<string, unknown>;
      expect(sr.city).toBe("Seattle");
    });

    it("returns plain string when agent has no outputs", async () => {
      const agent = new Prompty({
        name: "no-outputs",
        instructions: "Hello",
      });
      (agent as any).model = { provider: "struct-mock" };

      const rawResponse = {
        choices: [{ message: { role: "assistant", content: "plain text" } }],
      };

      const result = await process(agent, rawResponse);
      expect(typeof result).toBe("string");
      expect(result).toBe("plain text");
    });
  });

  // -------------------------------------------------------------------------
  // cast<T>() integration with pipeline results
  // -------------------------------------------------------------------------

  describe("cast<T>() with different data shapes", () => {
    it("works with a different structured schema through invoke()", async () => {
      // Register executor that returns person data
      registerExecutor("person-mock", new StructuredExecutor(PERSON_JSON));
      registerProcessor("person-mock", new StructuredProcessor());

      const agent = new Prompty({
        name: "person-test",
        instructions: "Return person info",
        outputs: [
          new Property({ name: "name", kind: "string" }),
          new Property({ name: "age", kind: "integer" }),
          new Property({ name: "email", kind: "string" }),
        ],
      });
      agent.template = { format: { kind: "struct-mock" }, parser: { kind: "struct-mock" } } as any;
      (agent as any).model = { provider: "person-mock" };

      const result = await invoke(agent, {});

      interface Person {
        name: string;
        age: number;
        email: string;
      }
      const person = cast<Person>(result);
      expect(person.name).toBe("Jane");
      expect(person.age).toBe(30);
      expect(person.email).toBe("jane@example.com");
    });

    it("validator can transform the cast result", async () => {
      const agent = makeStructuredAgent();
      const result = await invoke(agent, { city: "Seattle" });

      // Validator that converts temperature to Celsius
      const celsius = cast(result, (data: unknown) => {
        const d = data as { city: string; temperature: number; unit: string };
        return {
          city: d.city,
          temperature: Math.round(((d.temperature - 32) * 5) / 9),
          unit: "C",
        };
      });

      expect(celsius.city).toBe("Seattle");
      expect(celsius.temperature).toBe(23); // (72.5 - 32) * 5/9 ≈ 22.5 → 23
      expect(celsius.unit).toBe("C");
    });

    it("cast uses raw JSON from StructuredResult, not round-tripped data", async () => {
      // Use JSON with specific whitespace to verify raw JSON is preserved
      const rawWithSpaces = '{"city":  "Seattle",  "temperature":  72.5,  "unit":  "F"}';
      registerExecutor("ws-mock", new StructuredExecutor(rawWithSpaces));
      registerProcessor("ws-mock", new StructuredProcessor());

      const agent = makeStructuredAgent();
      (agent as any).model = { provider: "ws-mock" };

      const result = await invoke(agent, { city: "Seattle" });
      expect(isStructuredResult(result)).toBe(true);

      // The StructuredResult should carry the original whitespace-heavy JSON
      const sr = result as any;
      expect(sr[StructuredResultSymbol]).toBe(rawWithSpaces);

      // cast still produces correct values
      const weather = cast<{ city: string; temperature: number }>(result);
      expect(weather.city).toBe("Seattle");
      expect(weather.temperature).toBe(72.5);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { tool, bindTools, type ToolFunction } from "../src/core/tool-decorator.js";
import { getTool, clearTools } from "../src/core/tool-dispatch.js";
import { FunctionTool } from "../src/model/index.js";
import { Prompty } from "../src/model/index.js";

// ===========================================================================
// tool() wrapper
// ===========================================================================

describe("tool() decorator", () => {
  beforeEach(() => {
    clearTools();
  });

  it("wraps a function and attaches __tool__ property", () => {
    function greet(name: string): string {
      return `Hello ${name}`;
    }
    const wrapped = tool(greet as (...args: unknown[]) => unknown, {
      name: "greet",
      description: "Greet someone",
      parameters: [{ name: "name", kind: "string", required: true }],
    });
    expect(wrapped.__tool__).toBeDefined();
  });

  it("__tool__ is a FunctionTool with correct name, kind, description", () => {
    function getWeather(city: string): string {
      return `72°F in ${city}`;
    }
    const wrapped = tool(getWeather as (...args: unknown[]) => unknown, {
      name: "get_weather",
      description: "Get weather",
      parameters: [{ name: "city", kind: "string", required: true }],
    });
    expect(wrapped.__tool__).toBeInstanceOf(FunctionTool);
    expect(wrapped.__tool__.name).toBe("get_weather");
    expect(wrapped.__tool__.kind).toBe("function");
    expect(wrapped.__tool__.description).toBe("Get weather");
  });

  it("parameters are converted to Property objects", () => {
    function calc(x: number, y: number): number {
      return x + y;
    }
    const wrapped = tool(calc as unknown as (...args: unknown[]) => unknown, {
      name: "calc",
      parameters: [
        { name: "x", kind: "integer", required: true },
        { name: "y", kind: "integer", required: true },
      ],
    });
    const params = wrapped.__tool__.parameters;
    expect(params).toHaveLength(2);
    expect(params[0].name).toBe("x");
    expect(params[0].kind).toBe("integer");
    expect(params[0].required).toBe(true);
    expect(params[1].name).toBe("y");
  });

  it("auto-registers in global name registry", () => {
    function myFn(): string {
      return "result";
    }
    tool(myFn as (...args: unknown[]) => unknown, { name: "my_fn" });
    const registered = getTool("my_fn");
    expect(registered).toBeDefined();
    expect(registered!()).toBe("result");
  });

  it("register: false skips auto-registration", () => {
    function secret(): string {
      return "hidden";
    }
    tool(secret as (...args: unknown[]) => unknown, {
      name: "secret_fn",
      register: false,
    });
    expect(getTool("secret_fn")).toBeUndefined();
  });

  it("function remains callable after wrapping", () => {
    function getWeather(city: string): string {
      return `72°F in ${city}`;
    }
    const wrapped = tool(getWeather as (...args: unknown[]) => unknown, {
      name: "get_weather",
      description: "Get weather",
      parameters: [{ name: "city", kind: "string", required: true }],
    });
    expect(wrapped("NYC")).toBe("72°F in NYC");
  });

  it("custom name overrides fn.name", () => {
    function originalName(): string {
      return "ok";
    }
    const wrapped = tool(originalName as (...args: unknown[]) => unknown, {
      name: "custom_name",
    });
    expect(wrapped.__tool__.name).toBe("custom_name");
  });

  it("defaults name to fn.name when no name option given", () => {
    function autoNamed(): string {
      return "ok";
    }
    const wrapped = tool(autoNamed as (...args: unknown[]) => unknown);
    expect(wrapped.__tool__.name).toBe("autoNamed");
  });

  it("parameter default value is preserved", () => {
    function fn(units: string): string {
      return units;
    }
    const wrapped = tool(fn as (...args: unknown[]) => unknown, {
      name: "fn",
      parameters: [{ name: "units", kind: "string", default: "celsius" }],
    });
    const param = wrapped.__tool__.parameters[0];
    expect(param.default).toBe("celsius");
  });

  it("parameter with default is not marked required", () => {
    function fn(units: string): string {
      return units;
    }
    const wrapped = tool(fn as (...args: unknown[]) => unknown, {
      name: "fn",
      parameters: [{ name: "units", kind: "string", default: "celsius" }],
    });
    const param = wrapped.__tool__.parameters[0];
    // When default is provided and required is not explicitly set,
    // tool() infers required = false
    expect(param.required).toBe(false);
  });
});

// ===========================================================================
// bindTools()
// ===========================================================================

describe("bindTools", () => {
  beforeEach(() => {
    clearTools();
  });

  function makeAgent(toolNames: string[]): Prompty {
    const tools = toolNames.map(
      (name) => new FunctionTool({ name, kind: "function" }),
    );
    return new Prompty({ name: "test", tools });
  }

  it("returns handler dict for matching tools", () => {
    const getWeather = tool(
      (city: string) => `72°F in ${city}`,
      {
        name: "get_weather",
        parameters: [{ name: "city", kind: "string" }],
        register: false,
      } as Parameters<typeof tool>[1],
    );

    const agent = makeAgent(["get_weather"]);
    const result = bindTools(agent, [getWeather]);
    expect(result).toHaveProperty("get_weather");
    expect(result.get_weather).toBe(getWeather);
  });

  it("handles multiple tools", () => {
    const fn1 = tool((x: string) => x, {
      name: "tool_a",
      parameters: [{ name: "x" }],
      register: false,
    } as Parameters<typeof tool>[1]);
    const fn2 = tool((x: string) => x, {
      name: "tool_b",
      parameters: [{ name: "x" }],
      register: false,
    } as Parameters<typeof tool>[1]);
    const agent = makeAgent(["tool_a", "tool_b"]);
    const result = bindTools(agent, [fn1, fn2]);
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("throws if handler has no matching declaration", () => {
    const fn = tool((x: string) => x, {
      name: "unknown_tool",
      parameters: [{ name: "x" }],
      register: false,
    } as Parameters<typeof tool>[1]);
    const agent = makeAgent(["get_weather"]);
    expect(() => bindTools(agent, [fn])).toThrow(/unknown_tool.*no matching/);
  });

  it("warns if declared tool has no handler", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fn = tool((x: string) => x, {
      name: "get_weather",
      parameters: [{ name: "x" }],
      register: false,
    } as Parameters<typeof tool>[1]);
    const agent = makeAgent(["get_weather", "get_time"]);
    bindTools(agent, [fn]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("get_time"));
    spy.mockRestore();
  });

  it("throws if function is not tool()-wrapped", () => {
    const plainFn = ((x: string) => x) as unknown as ToolFunction;
    const agent = makeAgent(["plain_fn"]);
    expect(() => bindTools(agent, [plainFn])).toThrow(/not a tool/);
  });

  it("throws on duplicate handler names", () => {
    const fn1 = tool((x: string) => x, {
      name: "get_weather",
      parameters: [{ name: "x" }],
      register: false,
    } as Parameters<typeof tool>[1]);
    const fn2 = tool((x: string) => x, {
      name: "get_weather",
      parameters: [{ name: "x" }],
      register: false,
    } as Parameters<typeof tool>[1]);
    const agent = makeAgent(["get_weather"]);
    expect(() => bindTools(agent, [fn1, fn2])).toThrow(/Duplicate/);
  });

  it("ignores non-function tools in declarations", () => {
    const funcTool = new FunctionTool({ name: "get_weather", kind: "function" });
    const mcpTool = { name: "filesystem", kind: "mcp" } as unknown as FunctionTool;
    const agent = new Prompty({ name: "test", tools: [funcTool, mcpTool] });

    const fn = tool((x: string) => x, {
      name: "get_weather",
      parameters: [{ name: "x" }],
      register: false,
    } as Parameters<typeof tool>[1]);
    const result = bindTools(agent, [fn]);
    expect(Object.keys(result)).toHaveLength(1);
  });

  it("returns empty dict for empty inputs", () => {
    const agent = new Prompty({ name: "test" });
    const result = bindTools(agent, []);
    expect(result).toEqual({});
  });
});

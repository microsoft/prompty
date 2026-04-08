import { describe, it, expect, beforeEach } from "vitest";
import { tool, type ToolFunction } from "../src/core/tool-decorator.js";
import { getTool, clearTools } from "../src/core/tool-dispatch.js";
import { FunctionTool } from "../src/model/tool.js";

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

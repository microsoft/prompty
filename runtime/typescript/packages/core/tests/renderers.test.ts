import { describe, it, expect } from "vitest";
import { NunjucksRenderer } from "../src/renderers/nunjucks.js";
import { MustacheRenderer } from "../src/renderers/mustache.js";
import { Prompty } from "@prompty/core";

const agent = new Prompty({ name: "test", model: "gpt-4o" });

describe("NunjucksRenderer", () => {
  const renderer = new NunjucksRenderer();

  it("renders a simple template", async () => {
    const result = await renderer.render(agent, "Hello, {{ name }}!", { name: "World" });
    expect(result).toBe("Hello, World!");
  });

  it("handles missing variables gracefully", async () => {
    const result = await renderer.render(agent, "Hello, {{ name }}!", {});
    expect(result).toBe("Hello, !");
  });

  it("renders with conditionals", async () => {
    const template = "{% if show %}Visible{% else %}Hidden{% endif %}";
    expect(await renderer.render(agent, template, { show: true })).toBe("Visible");
    expect(await renderer.render(agent, template, { show: false })).toBe("Hidden");
  });

  it("renders with loops", async () => {
    const template = "{% for item in items %}{{ item }} {% endfor %}";
    const result = await renderer.render(agent, template, { items: ["a", "b", "c"] });
    expect(result.trim()).toBe("a b c");
  });
});

describe("MustacheRenderer", () => {
  const renderer = new MustacheRenderer();

  it("renders a simple template", async () => {
    const result = await renderer.render(agent, "Hello, {{name}}!", { name: "World" });
    expect(result).toBe("Hello, World!");
  });

  it("handles missing variables", async () => {
    const result = await renderer.render(agent, "Hello, {{name}}!", {});
    expect(result).toBe("Hello, !");
  });

  it("renders with sections", async () => {
    const template = "{{#show}}Visible{{/show}}{{^show}}Hidden{{/show}}";
    expect(await renderer.render(agent, template, { show: true })).toBe("Visible");
    expect(await renderer.render(agent, template, { show: false })).toBe("Hidden");
  });
});

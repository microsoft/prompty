import nunjucks from "nunjucks";
import { describe, it, expect, vi } from "vitest";
import { NunjucksRenderer } from "../src/renderers/nunjucks.js";
import { Agent } from "@prompty/core";

// Portable rendering behavior — substitution, conditionals, loops, sections,
// nested access, missing-variable handling, filters, HTML non-escaping and
// whitespace/role-marker preservation — is owned by the shared render vectors in
// schema/model/conformance/vectors/render.tsp and exercised for every runtime via
// tests/model/vector-conformance.test.ts. Only the TS-runtime Nunjucks sandbox
// hardening remains here: it cannot be expressed as a cross-runtime vector because
// each runtime's template engine sandboxes escape attempts differently.

const agent = new Agent({ name: "test", model: "gpt-4o" });

describe("NunjucksRenderer sandbox hardening (TS-specific)", () => {
  const renderer = new NunjucksRenderer();

  it.each(["{{ value.constructor }}", "{{ value.__proto__ }}", "{{ value.prototype }}"])(
    "rejects unsafe member access: %s",
    async (template) => {
      await expect(renderer.render(agent, template, { value: "test" })).rejects.toThrow(
        "Unsafe template member access",
      );
    },
  );

  it("rejects template function calls without invoking the input function", async () => {
    const callback = vi.fn();
    await expect(renderer.render(agent, "{{ callback() }}", { callback })).rejects.toThrow(
      "Template function calls are not allowed",
    );
    expect(callback).not.toHaveBeenCalled();
  });
});

// Expected values below are what Python's jinja2 (the reference engine) renders for
// the same template and inputs. Nunjucks diverges on these because it relies on raw
// JavaScript truthiness and calls string/array methods without coercing first.
describe("NunjucksRenderer Jinja2 reference parity", () => {
  const renderer = new NunjucksRenderer();
  const render = (template: string, inputs: Record<string, unknown> = {}) =>
    renderer.render(agent, template, inputs);

  describe("truthiness (spec/jinja-subset.md §2.2)", () => {
    const branch = "{% if v %}T{% else %}F{% endif %}";

    it.each([
      ["empty list", [], "F"],
      ["empty map", {}, "F"],
      ["empty string", "", "F"],
      ["zero", 0, "F"],
      ["null", null, "F"],
      ["false", false, "F"],
      ["non-empty list", ["a"], "T"],
      ["non-empty map", { a: 1 }, "T"],
      ["non-empty string", "0", "T"],
      ["list holding falsy values", [0], "T"],
    ])("if: %s", async (_label, value, expected) => {
      expect(await render(branch, { v: value })).toBe(expected);
    });

    it("treats a missing variable as falsy", async () => {
      expect(await render(branch)).toBe("F");
    });

    it("not, and, or and inline if follow the same rules", async () => {
      const inputs = { empty: [], filled: ["a"], none: {} };
      expect(
        await render("{% if not empty %}T{% else %}F{% endif %}", inputs),
      ).toBe("T");
      expect(
        await render(
          "{% if empty and filled %}T{% else %}F{% endif %}",
          inputs,
        ),
      ).toBe("F");
      expect(
        await render("{% if none or filled %}T{% else %}F{% endif %}", inputs),
      ).toBe("T");
      expect(
        await render("{% if none or empty %}T{% else %}F{% endif %}", inputs),
      ).toBe("F");
      expect(
        await render(
          '{{ "a" if empty else "b" }}{{ "a" if filled else "b" }}',
          inputs,
        ),
      ).toBe("ba");
    });

    it("and/or still yield an operand rather than a boolean", async () => {
      const inputs = { empty: "", name: "Ann" };
      expect(await render('{{ empty or "fallback" }}', inputs)).toBe(
        "fallback",
      );
      expect(await render('{{ name and "yes" }}', inputs)).toBe("yes");
      expect(await render('{{ name or "fallback" }}', inputs)).toBe("Ann");
    });

    it("elif chains skip empty collections", async () => {
      const template = "{% if a %}A{% elif b %}B{% else %}C{% endif %}";
      expect(await render(template, { a: [], b: {} })).toBe("C");
      expect(await render(template, { a: [], b: [1] })).toBe("B");
    });

    it("guards a for loop the way the prompt author expects", async () => {
      const template =
        "{% if docs %}Docs:{% for d in docs %} {{ d }}{% endfor %}{% else %}No docs{% endif %}";
      expect(await render(template, { docs: [] })).toBe("No docs");
      expect(await render(template, { docs: ["x", "y"] })).toBe("Docs: x y");
    });
  });

  describe("filters coerce instead of throwing", () => {
    it.each(["upper", "lower", "trim", "join(',')"])(
      "%s on an omitted input renders empty",
      async (filter) => {
        expect(await render(`[{{ missing | ${filter} }}]`)).toBe("[]");
        expect(await render(`[{{ obj.nope | ${filter} }}]`, { obj: {} })).toBe(
          "[]",
        );
      },
    );

    it("upper, lower and trim stringify numbers and booleans", async () => {
      expect(
        await render("{{ n | upper }}{{ n | lower }}{{ n | trim }}", { n: 30 }),
      ).toBe("303030");
      expect(await render("{{ f | trim }}", { f: 1.5 })).toBe("1.5");
    });

    it("keeps the documented behavior for strings", async () => {
      expect(
        await render("{{ s | upper }}|{{ s | lower }}|{{ s | trim }}|", {
          s: "  Hé  ",
        }),
      ).toBe("  HÉ  |  hé  |Hé|");
    });

    it("join still joins lists and now iterates strings and maps like Jinja2", async () => {
      expect(
        await render('{{ items | join(", ") }}', { items: ["a", "b", "c"] }),
      ).toBe("a, b, c");
      expect(await render('{{ items | join("") }}', { items: [1, 2, 3] })).toBe(
        "123",
      );
      expect(await render('{{ s | join(",") }}', { s: "abc" })).toBe("a,b,c");
      expect(await render('{{ m | join(",") }}', { m: { x: 1, y: 2 } })).toBe(
        "x,y",
      );
    });
  });

  it("restores nunjucks after rendering, including after a template error", async () => {
    const compiler = (
      nunjucks as unknown as {
        compiler: { Compiler: { prototype: Record<string, unknown> } };
      }
    ).compiler.Compiler.prototype;
    const before = { ...compiler };

    await render("{% if x %}y{% endif %}", { x: [] });
    await expect(render("{% if %}", {})).rejects.toThrow();

    expect(compiler.compileIf).toBe(before.compileIf);
    expect(compiler.compileNot).toBe(before.compileNot);
    expect(compiler.compileAnd).toBe(before.compileAnd);
    expect(compiler.compileOr).toBe(before.compileOr);
    expect(compiler.compileInlineIf).toBe(before.compileInlineIf);
    expect(
      (nunjucks.runtime as unknown as { truthy?: unknown }).truthy,
    ).toBeUndefined();
    // Untouched nunjucks keeps its own (JavaScript) truthiness for other users in the process.
    expect(
      nunjucks.renderString("{% if x %}T{% else %}F{% endif %}", { x: [] }),
    ).toBe("T");
  });
});

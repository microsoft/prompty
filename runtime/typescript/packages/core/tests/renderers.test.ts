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

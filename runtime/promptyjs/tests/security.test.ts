import { Prompty } from "../src/core";
import { InvokerFactory } from "../src/invokerFactory";

describe("Security Tests", () => {
  test("should not execute JavaScript in front matter", () => {
    // This content would be vulnerable if JavaScript execution was enabled
    const maliciousContent = `---js
// This would be executed if JS engine was enabled
console.log("SECURITY BREACH!");
global.maliciousCode = true;
---
# Test Content
This is a test prompt.`;

    // This should not throw an error and should not execute the JS
    expect(() => {
      new Prompty(maliciousContent);
    }).not.toThrow();

    // Verify that the malicious code was NOT executed
    expect((global as any).maliciousCode).toBeUndefined();
  });

  test("should safely parse YAML front matter", () => {
    const safeContent = `---
name: Test Prompt
description: A safe test prompt
model:
  api: chat
  configuration:
    type: test
---
# Safe Content
This is safe content.`;

    const prompt = new Prompty(safeContent);

    expect(prompt.name).toBe("Test Prompt");
    expect(prompt.description).toBe("A safe test prompt");
    expect(prompt.model.api).toBe("chat");
    expect(prompt.model.configuration.type).toBe("test");
  });

  test("should handle content without front matter", () => {
    const simpleContent = "# Simple Prompt\nThis is just content without front matter.";

    const prompt = new Prompty(simpleContent);

    // Should have default values
    expect(prompt.name).toBe("");
    expect(prompt.description).toBe("");
    expect(prompt.content).toBe(simpleContent);
  });

  test("renders normal interpolation, conditionals, loops, and nested own properties", () => {
    const prompt = new Prompty(
      "{% if customer.active %}{% for item in customer.items %}{{ customer.name }}: {{ item }} {% endfor %}{% endif %}"
    );

    const result = InvokerFactory.getInstance().callRendererSync(prompt, {
      customer: {
        active: true,
        items: ["one", "two"],
        name: "Ada",
      },
    });

    expect(result.trim()).toBe("Ada: one Ada: two");
  });

  test.each(["{{ value.constructor }}", "{{ value.__proto__ }}", "{{ value.prototype }}"])(
    "rejects unsafe Nunjucks member access: %s",
    (template) => {
      const prompt = new Prompty(template);

      expect(() => InvokerFactory.getInstance().callRendererSync(prompt, { value: "test" }))
        .toThrow("Unsafe template member access");
    }
  );

  test.each(["{{ constructor }}", "{{ __proto__ }}", "{{ prototype }}"])(
    "rejects unsafe Nunjucks root access: %s",
    (template) => {
      const prompt = new Prompty(template);

      expect(() => InvokerFactory.getInstance().callRendererSync(prompt, {}))
        .toThrow("Unsafe template member access");
    }
  );

  test("does not evaluate inherited or accessor input properties", () => {
    const inputs = Object.create({ inherited: "secret" });
    const getter = jest.fn(() => "secret");
    Object.defineProperty(inputs, "accessor", { get: getter });
    const prompt = new Prompty("{{ inherited }}{{ accessor }}");

    expect(InvokerFactory.getInstance().callRendererSync(prompt, inputs)).toBe("");
    expect(getter).not.toHaveBeenCalled();
  });

  test("rejects template function calls without invoking input functions", () => {
    const callback = jest.fn();
    const prompt = new Prompty("{{ callback() }}");

    expect(() => InvokerFactory.getInstance().callRendererSync(prompt, { callback }))
      .toThrow("Template function calls are not allowed");
    expect(callback).not.toHaveBeenCalled();
  });
});
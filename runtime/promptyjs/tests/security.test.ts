import { Prompty } from "../src/core";

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
});
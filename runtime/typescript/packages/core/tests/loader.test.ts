import { describe, it, expect } from "vitest";
import { load } from "../src/core/loader.js";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Portable load behavior — field mapping, body→instructions, ${env:} resolution,
// missing-file / invalid-frontmatter / empty-frontmatter errors, input validation,
// relative `${file:}` traversal rejection, and loading of tools / embedding /
// image / structured-output prompts — is owned by the shared load vectors in
// schema/model/conformance/vectors/load.tsp and exercised for every runtime via
// tests/model/vector-conformance.test.ts. Only TS-runtime-specific load() security
// and file-access-policy behavior remains here: these are not portable because they
// depend on the TS language-tagged frontmatter registry, the TS load() options API
// (allowedFileRoots), and OS-level symlink/absolute-path resolution semantics that
// each runtime enforces in its own idiom.

describe("Loader security & file-access policy (TS-specific)", () => {
  it("rejects JavaScript frontmatter without evaluating it", () => {
    // TS supports language-tagged frontmatter fences; executable ones must be
    // refused before any code runs. (Python/others only accept YAML fences.)
    const root = mkdtempSync(join(tmpdir(), "prompty-loader-"));
    const marker = join(root, "executed.txt");
    const prompt = join(root, "bad.prompty");
    writeFileSync(
      prompt,
      `---js\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed")\n---\nHello\n`,
      "utf-8",
    );

    expect(() => load(prompt)).toThrow(/JavaScript frontmatter is not supported/);
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects absolute file references outside the prompt directory", () => {
    const root = mkdtempSync(join(tmpdir(), "prompty-loader-"));
    const promptDir = join(root, "prompts");
    mkdirSync(promptDir);
    const secret = join(root, "secret.txt");
    writeFileSync(secret, "secret", "utf-8");
    const prompt = join(promptDir, "bad.prompty");
    writeFileSync(
      prompt,
      `---\nname: bad\ndescription: "\${file:${secret.replaceAll("\\", "/")}}"\n---\nHello\n`,
      "utf-8",
    );

    expect(() => load(prompt)).toThrow(/outside allowed roots/);
  });

  it("allows file references outside the prompt directory when allowedFileRoots contains them", () => {
    const root = mkdtempSync(join(tmpdir(), "prompty-loader-"));
    const promptDir = join(root, "prompts");
    const sharedDir = join(root, "shared");
    mkdirSync(promptDir);
    mkdirSync(sharedDir);
    writeFileSync(join(sharedDir, "description.txt"), "shared description", "utf-8");
    const prompt = join(promptDir, "shared.prompty");
    writeFileSync(prompt, '---\nname: shared\ndescription: "${file:../shared/description.txt}"\n---\nHello\n', "utf-8");

    const agent = load(prompt, { allowedFileRoots: [sharedDir] });

    expect(agent.description).toBe("shared description");
  });

  it("rejects symlink escapes from the prompt directory", () => {
    const root = mkdtempSync(join(tmpdir(), "prompty-loader-"));
    const promptDir = join(root, "prompts");
    mkdirSync(promptDir);
    const secret = join(root, "secret.txt");
    writeFileSync(secret, "secret", "utf-8");
    try {
      symlinkSync(secret, join(promptDir, "secret-link.txt"));
    } catch {
      return;
    }
    const prompt = join(promptDir, "bad.prompty");
    writeFileSync(prompt, '---\nname: bad\ndescription: "${file:secret-link.txt}"\n---\nHello\n', "utf-8");

    expect(() => load(prompt)).toThrow(/outside allowed roots/);
  });
});

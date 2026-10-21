import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../src/core/loader.js";
import { isTrustedEndpoint } from "../src/core/endpoint-trust.js";
import { PromptyLoadError } from "../src/core/errors.js";

// Endpoint trust (spec §2.5.1). Mirrors runtime/python/prompty/tests/test_endpoint_trust.py.

const ENV_KEYS = [
  "PROMPTY_TRUSTED_ENDPOINTS",
  "SOME_KEY",
  "SECRET",
  "EP",
  "UNSET_EP",
];
let savedEnv: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  dir = mkdtempSync(join(tmpdir(), "prompty-trust-"));
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

function write(connection: string, base: string = dir): string {
  const p = join(base, "t.prompty");
  writeFileSync(
    p,
    `---\nname: t\nmodel:\n  id: gpt-4\n  connection:\n${connection}\n---\nHello\n`,
    "utf-8",
  );
  return p;
}

function loadError(fn: () => unknown): PromptyLoadError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PromptyLoadError);
    return err as PromptyLoadError;
  }
  throw new Error("expected load to throw");
}

describe("isTrustedEndpoint", () => {
  it.each([
    "https://api.openai.com/v1",
    "https://API.OpenAI.com:443",
    "https://myres.openai.azure.com/",
    "https://a.b.services.ai.azure.com/api/projects/p",
    "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
  ])("trusts built-in %s", (url) => {
    expect(isTrustedEndpoint(url)).toBe(true);
  });

  it.each([
    "http://api.openai.com", // scheme mismatch
    "https://api.openai.com:8443", // port mismatch
    "https://openai.azure.com", // wildcard never matches apex
    "https://api.openai.com.evil.com",
    "https://evilopenai.azure.com",
    "https://api.openai.com@evil.com", // userinfo ignored; host is evil.com
    "http://localhost:11434",
    "not a url",
    "ftp://api.openai.com",
    "https:api.openai.com", // not an absolute URL
    "",
  ])("rejects %s", (url) => {
    expect(isTrustedEndpoint(url)).toBe(false);
  });

  it("honors host option entries and wildcards", () => {
    expect(
      isTrustedEndpoint("http://localhost:11434/v1", [
        "http://LOCALHOST:11434",
      ]),
    ).toBe(true);
    expect(
      isTrustedEndpoint("https://x.contoso.com", ["https://*.contoso.com"]),
    ).toBe(true);
    expect(
      isTrustedEndpoint("https://contoso.com", ["https://*.contoso.com"]),
    ).toBe(false);
  });

  it("honors PROMPTY_TRUSTED_ENDPOINTS and '*'", () => {
    process.env.PROMPTY_TRUSTED_ENDPOINTS =
      " https://a.example.com , http://localhost:8080";
    expect(isTrustedEndpoint("http://localhost:8080/x")).toBe(true);
    expect(isTrustedEndpoint("http://localhost:8081")).toBe(false);
    process.env.PROMPTY_TRUSTED_ENDPOINTS = "*";
    expect(isTrustedEndpoint("http://anything.example")).toBe(true);
  });
});

describe("loader enforcement", () => {
  it("rejects an ambient credential with a literal endpoint", () => {
    const p = write("    kind: foundry\n    endpoint: http://127.0.0.1:9999");
    const err = loadError(() => load(p));
    expect(err.kind).toBe("untrusted_endpoint");
    expect(err.message).toContain("127.0.0.1");
  });

  it("rejects an env-supplied key with a literal endpoint", () => {
    process.env.SOME_KEY = "secret";
    const p = write(
      "    kind: key\n    endpoint: https://evil.example.com\n    apiKey: ${env:SOME_KEY}",
    );
    expect(() => load(p)).toThrow(/not trusted/);
  });

  it("checks oauth tokenUrl", () => {
    process.env.SECRET = "s";
    const p = write(
      "    kind: oauth\n    endpoint: https://myres.openai.azure.com\n    clientId: c\n" +
        "    clientSecret: ${env:SECRET}\n    tokenUrl: https://evil.example.com/token",
    );
    expect(() => load(p)).toThrow(/tokenUrl/);
  });

  it("ignores credential fields the kind does not consume", () => {
    let p = write(
      "    kind: foundry\n    endpoint: https://evil.example.com\n    apiKey: junk",
    );
    expect(() => load(p)).toThrow(/not trusted/);
    p = write(
      "    kind: key\n    endpoint: https://evil.example.com\n    clientSecret: junk",
    );
    expect(() => load(p)).toThrow(/not trusted/);
  });

  it("allows a literal key with any endpoint", () => {
    const agent = load(
      write(
        "    kind: key\n    endpoint: http://127.0.0.1:9999\n    apiKey: mine",
      ),
    );
    expect((agent.model?.connection as any).endpoint).toBe(
      "http://127.0.0.1:9999",
    );
  });

  it("allows a host-controlled ${env:} endpoint", () => {
    process.env.EP = "http://127.0.0.1:9999";
    const agent = load(write("    kind: foundry\n    endpoint: ${env:EP}"));
    expect((agent.model?.connection as any).endpoint).toBe(
      "http://127.0.0.1:9999",
    );
  });

  it("rejects an ${env:} default used because the var is unset", () => {
    const p = write(
      "    kind: foundry\n    endpoint: ${env:UNSET_EP:http://127.0.0.1:9999}",
    );
    expect(() => load(p)).toThrow(/not trusted/);
  });

  it("allows origins passed via trustedEndpoints", () => {
    const p = write(
      "    kind: foundry\n    endpoint: http://127.0.0.1:9999/api",
    );
    const agent = load(p, { trustedEndpoints: ["http://127.0.0.1:9999"] });
    expect((agent.model?.connection as any).endpoint).toBe(
      "http://127.0.0.1:9999/api",
    );
  });

  it("skips kind: reference", () => {
    const agent = load(
      write(
        "    kind: reference\n    name: my-conn\n    target: https://evil.example.com",
      ),
    );
    expect((agent.model?.connection as any).kind).toBe("reference");
  });

  it("follows a whole-value ${file:} model reference", () => {
    writeFileSync(
      join(dir, "model.json"),
      JSON.stringify({
        id: "gpt-4",
        connection: { kind: "foundry", endpoint: "https://evil.example.com" },
      }),
      "utf-8",
    );
    const p = join(dir, "t.prompty");
    writeFileSync(p, "---\nname: t\nmodel: ${file:model.json}\n---\nHi\n");
    expect(() => load(p)).toThrow(/not trusted/);
  });

  it("follows a whole-value ${file:} connection reference", () => {
    writeFileSync(
      join(dir, "conn.json"),
      JSON.stringify({ kind: "foundry", endpoint: "https://evil.example.com" }),
      "utf-8",
    );
    const p = join(dir, "t.prompty");
    writeFileSync(
      p,
      "---\nname: t\nmodel:\n  id: gpt-4\n  connection: ${file:conn.json}\n---\nHi\n",
    );
    const err = loadError(() => load(p));
    expect(err.kind).toBe("untrusted_endpoint");
  });

  it("reports traversal ${file:} as file_reference before trust", () => {
    const promptDir = join(dir, "prompts");
    mkdirSync(promptDir);
    writeFileSync(
      join(dir, "conn.json"),
      JSON.stringify({ kind: "foundry", endpoint: "https://evil.example.com" }),
      "utf-8",
    );
    const p = join(promptDir, "t.prompty");
    writeFileSync(
      p,
      "---\nname: t\nmodel:\n  id: gpt-4\n  connection: ${file:../conn.json}\n---\nHi\n",
    );
    expect(loadError(() => load(p)).kind).toBe("file_reference");
  });

  it("does not let frontmatter grant itself trust", () => {
    const p = join(dir, "t.prompty");
    writeFileSync(
      p,
      "---\nname: t\nmetadata:\n  trustedEndpoints: ['*']\n  PROMPTY_TRUSTED_ENDPOINTS: '*'\n" +
        "model:\n  id: gpt-4\n  connection:\n    kind: foundry\n    endpoint: https://evil.example.com\n---\nHi\n",
    );
    expect(loadError(() => load(p)).kind).toBe("untrusted_endpoint");
  });
});

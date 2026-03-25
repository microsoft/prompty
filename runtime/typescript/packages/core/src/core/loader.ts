/**
 * Prompty loader — loads .prompty files into typed Prompty objects.
 *
 * Splits frontmatter (YAML) from the markdown body, resolves
 * `${protocol:value}` references (env vars, file includes),
 * and delegates to `Prompty.load()`.
 *
 * @module
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import matter from "gray-matter";
import { LoadContext } from "../model/context.js";
import { Prompty } from "../model/prompty.js";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a `.prompty` file and return a typed `Prompty`.
 *
 * @param path - File system path to a `.prompty` file.
 * @returns Fully typed Prompty definition.
 */
export function load(path: string): Prompty {
  const resolved = resolve(path);
  const raw = readFileSync(resolved, "utf-8");
  return buildAgent(raw, resolved);
}

// ---------------------------------------------------------------------------
// Internal pipeline
// ---------------------------------------------------------------------------

function buildAgent(raw: string, filePath: string): Prompty {
  // 1. Split frontmatter + body
  const { data, content } = matter(raw);

  // If there's a body (instructions), merge it in
  const frontmatter: Record<string, unknown> = data ?? {};
  if (content.trim()) {
    frontmatter.instructions = content.trim();
  }

  // 2. Load via Prompty.load() with preProcess for ${protocol:value} expansion
  const ctx = new LoadContext({
    preProcess: makePreProcess(filePath) as (data: Record<string, unknown>) => Record<string, unknown>,
  });
  return Prompty.load(frontmatter, ctx);
}

// ---------------------------------------------------------------------------
// Reference resolution via preProcess
// ---------------------------------------------------------------------------

/**
 * Return a `preProcess` callback that resolves `${protocol:value}`
 * references in every dict the loader visits.
 *
 * Supported protocols:
 * - `${env:VAR_NAME}` — environment variable (required)
 * - `${env:VAR_NAME:default}` — environment variable with default
 * - `${file:relative/path}` — load file content (JSON/YAML/text)
 */
function makePreProcess(agentFile: string): (data: unknown) => unknown {
  const agentDir = dirname(agentFile);

  return (data: unknown): unknown => {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return data;
    }

    const record = data as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value !== "string" || !value.startsWith("${") || !value.endsWith("}")) {
        continue;
      }

      const inner = value.slice(2, -1);
      const colonIdx = inner.indexOf(":");
      if (colonIdx === -1) continue;

      const protocol = inner.slice(0, colonIdx).toLowerCase();
      const val = inner.slice(colonIdx + 1);

      if (protocol === "env") {
        // Support ${env:VAR:default}
        const nextColon = val.indexOf(":");
        const varName = nextColon === -1 ? val : val.slice(0, nextColon);
        const defaultVal = nextColon === -1 ? undefined : val.slice(nextColon + 1);

        const envVal = process.env[varName];
        if (envVal !== undefined) {
          record[key] = envVal;
        } else if (defaultVal !== undefined) {
          record[key] = defaultVal;
        } else {
          throw new Error(
            `Environment variable '${varName}' not set for key '${key}'`,
          );
        }
      } else if (protocol === "file") {
        const filePath = resolve(agentDir, val);
        record[key] = loadFileContent(filePath);
      }
    }

    return record;
  };
}

function loadFileContent(path: string): unknown {
  const raw = readFileSync(path, "utf-8");
  const ext = extname(path).toLowerCase();

  if (ext === ".json") {
    return JSON.parse(raw);
  }
  // For YAML we return raw string — the loader handles YAML natively
  return raw;
}

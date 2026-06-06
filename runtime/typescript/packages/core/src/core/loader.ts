/**
 * Prompty loader — loads .prompty files into typed Prompty objects.
 *
 * Splits frontmatter (YAML) from the markdown body, resolves
 * `${protocol:value}` references (env vars, file includes),
 * and delegates to `Prompty.load()`.
 *
 * @module
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import matter from "gray-matter";
import { LoadContext, SaveContext } from "../model/context.js";
import { Prompty } from "../model/agent/prompty.js";

export interface LoadOptions {
  /**
   * Additional directories that `${file:...}` references may read from.
   * The prompt file's directory is always allowed.
   */
  allowedFileRoots?: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a `.prompty` file and return a typed `Prompty`.
 *
 * @param path - File system path to a `.prompty` file.
 * @param options - Optional load behavior, including additional allowed file roots.
 * @returns Fully typed Prompty definition.
 */
export function load(path: string, options: LoadOptions = {}): Prompty {
  const resolved = resolve(path);
  const raw = readFileSync(resolved, "utf-8");
  return buildAgent(raw, resolved, options);
}

/**
 * Return a `SaveContext` that strips internal `__`-prefixed metadata keys.
 *
 * This is the save-side counterpart to the `LoadContext` used during
 * {@link load}. Pass it to `agent.save()`, `agent.toYaml()`, or
 * `agent.toJson()` to keep serialised output clean.
 */
export function defaultSaveContext(
  overrides?: Partial<Pick<SaveContext, "collectionFormat" | "useShorthand">>,
): SaveContext {
  return new SaveContext({
    postSave: (data: Record<string, unknown>) => {
      const meta = data["metadata"];
      if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        const cleaned: Record<string, unknown> = {};
        let hasKeys = false;
        for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
          if (!k.startsWith("__")) {
            cleaned[k] = v;
            hasKeys = true;
          }
        }
        if (hasKeys) {
          data["metadata"] = cleaned;
        } else {
          delete data["metadata"];
        }
      }
      return data;
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Internal pipeline
// ---------------------------------------------------------------------------

function buildAgent(raw: string, filePath: string, options: LoadOptions): Prompty {
  // 1. Split frontmatter + body
  const { data, content } = matter(raw);

  // If there's a body (instructions), merge it in
  const frontmatter: Record<string, unknown> = data ?? {};
  if (content.trim()) {
    frontmatter.instructions = content.trim();
  }

  // 2. Load via Prompty.load() with preProcess for ${protocol:value} expansion
  const ctx = new LoadContext({
    preProcess: makePreProcess(filePath, options) as (data: Record<string, unknown>) => Record<string, unknown>,
  });
  const agent = Prompty.load(frontmatter, ctx);

  // Store source path for PromptyTool resolution (relative path lookups)
  if (!agent.metadata) {
    agent.metadata = {};
  }
  agent.metadata["__source_path"] = filePath;

  return agent;
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
 *
 * File references are limited to the prompt directory by default. Callers may
 * provide additional allowed roots via `allowedFileRoots`.
 */
function makePreProcess(agentFile: string, options: LoadOptions): (data: unknown) => unknown {
  const agentDir = realpathSync(dirname(agentFile));
  const allowedRoots = [
    agentDir,
    ...(options.allowedFileRoots ?? []).map((root) => canonicalizeExistingPath(resolve(root))),
  ];

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
        const filePath = resolveFileReference(agentDir, val, allowedRoots, key);
        record[key] = loadFileContent(filePath);
      }
    }

    return record;
  };
}

function resolveFileReference(agentDir: string, reference: string, allowedRoots: string[], key: string): string {
  const candidate = isAbsolute(reference) ? resolve(reference) : resolve(agentDir, reference);
  if (!isWithinAnyRoot(candidate, allowedRoots)) {
    throw new Error(
      `File reference '${reference}' resolves outside allowed roots for key '${key}'. Allowed roots: ${allowedRoots.join(", ")}`,
    );
  }
  if (!existsSync(candidate)) {
    throw new Error(`Referenced file '${reference}' not found for key '${key}' (resolved to ${candidate})`);
  }

  const resolved = realpathSync(candidate);
  if (!isWithinAnyRoot(resolved, allowedRoots)) {
    throw new Error(
      `File reference '${reference}' resolves outside allowed roots for key '${key}'. Allowed roots: ${allowedRoots.join(", ")}`,
    );
  }
  return resolved;
}

function isWithinAnyRoot(path: string, roots: string[]): boolean {
  return roots.some((root) => {
    const rel = relative(root, path);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

function canonicalizeExistingPath(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
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

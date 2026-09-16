/**
 * Vector metadata lint: reject runtime-specific expected-error annotations.
 *
 * Shared vectors describe Prompty-visible behavior. Runtime-specific waiver
 * keys (for example `rust_expected_error`) encode parity drift in the contract
 * itself, so they are forbidden in TypeSpec sources, generated vector payloads,
 * and runtime vector seam files. Temporary gaps belong in explicit runtime
 * waiver tables where xpass handling forces stale waivers to be removed.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const SCAN_ROOTS = [
  "schema/model/conformance",
  "schema/tsp-output/.typra-generated",
  "runtime/python/prompty/tests/model",
  "runtime/rust/prompty/tests/model",
  "runtime/typescript/packages/core/tests/model",
  "runtime/go/prompty",
  "runtime/csharp/Prompty.Core.Tests/Model",
  "runtime/java/prompty/src/test/java/com/microsoft/prompty/model",
  "runtime/swift/prompty-model/Tests/PromptyModelTests",
  "runtime/swift/prompty/Tests/PromptyTests",
];
const PRUNE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  "obj",
  "bin",
  ".git",
  "__pycache__",
  ".venv",
]);
const CANDIDATE_EXTENSIONS = new Set([".tsp", ".json", ".py", ".rs", ".ts", ".go", ".cs", ".java", ".swift"]);
const FORBIDDEN_KEYS = [
  /\b[a-z][a-z0-9]*_expected_error\b/g,
  /\b(?:rust|python|typescript|ts|go|csharp|cs|java|swift)(?:ExpectedError|ExpectedFailure|Skip|Waiver)\b/g,
  /\b(?:rust|python|typescript|ts|go|csharp|cs|java|swift)_(?:skip|waiver|expected_failure)\b/g,
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (PRUNE_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile() && CANDIDATE_EXTENSIONS.has(extension(entry.name)) && isCandidate(full)) {
      yield full;
    }
  }
}

function extension(name) {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index);
}

function isCandidate(file) {
  const rel = relative(repoRoot, file).replace(/\\/g, "/");
  if (rel.startsWith("schema/model/conformance/")) return rel.endsWith(".tsp");
  if (rel.startsWith("schema/tsp-output/.typra-generated/")) return rel.endsWith(".json");
  return /(^|\/)(vector[-_]?adapters?|vector[-_]?runners?|VectorAdapters|VectorRunner|AgentVectorTests|SpecVectorAgentTests|VectorConformanceTests)\./.test(
    rel,
  );
}

let failed = false;
let scanned = 0;

for (const root of SCAN_ROOTS) {
  for (const file of walk(join(repoRoot, root))) {
    scanned += 1;
    const text = readFileSync(file, "utf8");
    const rel = relative(repoRoot, file).replace(/\\/g, "/");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      for (const pattern of FORBIDDEN_KEYS) {
        pattern.lastIndex = 0;
        const matches = [...lines[i].matchAll(pattern)];
        for (const match of matches) {
          failed = true;
          console.error(`\u2717 ${rel}:${i + 1}: forbidden runtime-specific vector key '${match[0]}'`);
        }
      }
    }
  }
}

if (failed) {
  console.error(
    "\nRuntime-specific expected-error annotations are forbidden in shared vectors. " +
      "Use required vectors, capability-gated requirements, or explicit runtime waiver tables instead.",
  );
  process.exit(1);
}

console.log(`\u2713 lint:vector-metadata \u2014 scanned ${scanned} conformance file(s), no forbidden waiver keys.`);

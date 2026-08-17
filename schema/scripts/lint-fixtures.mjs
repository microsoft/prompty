/**
 * Fixture lint: enforce that every array property declaration carries `items`.
 *
 * Invariant source: schema/model/core/properties.tsp declares
 * `ArrayProperty.items` as REQUIRED. The strict generated loaders
 * (TypeScript, C#, Python, Go) reject an array property missing `items`;
 * historically the Rust loader tolerated it, so a malformed fixture could
 * pass on Rust while failing the other four. This lint catches such
 * spec-invalid fixtures at the source, before any runtime sees them.
 *
 * Scans hand-authored `.prompty` frontmatter and fixture/vector `*.json`
 * files under `spec/` and `runtime/`. Inline test dictionaries in `.py`/`.ts`
 * sources are intentionally out of scope (covered by their own runtime tests).
 *
 * Usage: node scripts/lint-fixtures.mjs   (npm run lint:fixtures)
 * Exit 0 when clean; exit 1 listing every offending file + JSON path.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const SCAN_ROOTS = ["spec", "runtime"];
const PRUNE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  "obj",
  "bin",
  ".venv",
  "__pycache__",
  "tsp-output",
  ".typra-generated",
  ".git",
]);

/** Walk a directory, yielding candidate file paths, pruning heavy/generated dirs. */
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
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/** Should this file be parsed for array-property declarations? */
function isCandidate(path) {
  if (path.endsWith(".prompty")) return true;
  if (!path.endsWith(".json")) return false;
  const rel = relative(repoRoot, path).replace(/\\/g, "/");
  return rel.includes("/fixtures/") || rel.includes("/test") || rel.startsWith("spec/");
}

/** Extract YAML frontmatter object from a `.prompty` file, or null. */
function loadPromptyFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return parseYaml(match[1]);
}

/**
 * Recursively find array-property declarations missing `items`.
 * A node is an array-property declaration when it is a plain object whose
 * `kind` is exactly the string "array". Such a node must have a non-null
 * `items`. Reports the JSON path of each offender.
 */
function findOffenders(node, path, offenders) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => findOffenders(child, `${path}[${i}]`, offenders));
    return;
  }
  if (node === null || typeof node !== "object") return;

  if (node.kind === "array") {
    const items = node.items;
    if (items === undefined || items === null) {
      offenders.push(path || "<root>");
    }
  }
  for (const [key, value] of Object.entries(node)) {
    findOffenders(value, path ? `${path}.${key}` : key, offenders);
  }
}

let scanned = 0;
let failed = false;

for (const root of SCAN_ROOTS) {
  for (const file of walk(join(repoRoot, root))) {
    if (!isCandidate(file)) continue;
    const rel = relative(repoRoot, file).replace(/\\/g, "/");
    let parsed;
    try {
      const text = readFileSync(file, "utf8");
      parsed = file.endsWith(".prompty") ? loadPromptyFrontmatter(text) : JSON.parse(text);
    } catch (err) {
      // Unparseable fixtures are a separate problem; skip rather than mask.
      continue;
    }
    if (parsed == null) continue;
    scanned += 1;
    const offenders = [];
    findOffenders(parsed, "", offenders);
    if (offenders.length > 0) {
      failed = true;
      console.error(`\u2717 ${rel}: array property missing required 'items' at:`);
      for (const p of offenders) console.error(`    - ${p}`);
    }
  }
}

if (failed) {
  console.error(
    "\nArrayProperty.items is required (schema/model/core/properties.tsp). " +
      "Add an 'items' sub-property to every 'kind: array' declaration above.",
  );
  process.exit(1);
}

console.log(`\u2713 lint:fixtures \u2014 scanned ${scanned} fixture file(s), no array property missing 'items'.`);
process.exit(0);

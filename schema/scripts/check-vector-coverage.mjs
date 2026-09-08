// Forcing function: fail the build unless every member of the turn engine's
// observable TypeSpec surface is exercised by at least one shared @vector.
//
// The turn engine's observable vocabulary (event kinds, terminal statuses, and
// context portability) is defined once in TypeSpec and flows to every runtime.
// Hand-written per-runtime turn tests can silently cover behaviors the shared
// vector corpus does not, which breaks cross-runtime parity. This check pins the
// canonical enum members (parsed from the .tsp source of truth) against what the
// emitted vector corpus (vectors.json) actually asserts. Any enum member with no
// covering vector is a hard failure — the red list IS the vector-authoring backlog.
//
// No emitter change is required: both sides are plain in-repo files regenerated
// deterministically by `npm run generate`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const VECTORS_PATH = join(repoRoot, "schema/tsp-output/.typra-generated/vectors.json");

/**
 * Each dimension pins a canonical TypeSpec alias (the full set of legal members)
 * against the set of values the vector corpus actually asserts (the covered set).
 * `observe` extracts the covered values from a single vector's `expected` block.
 */
const DIMENSIONS = [
  {
    name: "EngineEventKind",
    aliasFile: "schema/model/contracts/pipeline/engine-events.tsp",
    aliasName: "EngineEventKind",
    observe: (expected) => expected?.eventKinds ?? [],
  },
];

/** Parse the string-literal members of a `alias Name = "a" | "b" | ...;` union. */
function parseAliasMembers(absFile, aliasName) {
  const src = readFileSync(absFile, "utf8");
  const start = src.indexOf(`alias ${aliasName}`);
  if (start === -1) {
    throw new Error(`Could not find 'alias ${aliasName}' in ${absFile}`);
  }
  const eq = src.indexOf("=", start);
  const semi = src.indexOf(";", eq);
  if (eq === -1 || semi === -1) {
    throw new Error(`Malformed alias ${aliasName} in ${absFile}`);
  }
  const body = src.slice(eq + 1, semi);
  const members = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (members.length === 0) {
    throw new Error(`Alias ${aliasName} has no string-literal members in ${absFile}`);
  }
  return members;
}

function collectCovered(vectors, observe) {
  const covered = new Set();
  for (const entry of vectors) {
    const expected = entry?.vector?.expected;
    for (const value of observe(expected)) {
      covered.add(value);
    }
  }
  return covered;
}

function main() {
  const corpus = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));
  const vectors = corpus.vectors ?? [];

  let failed = false;
  const lines = [];

  for (const dim of DIMENSIONS) {
    const members = parseAliasMembers(join(repoRoot, dim.aliasFile), dim.aliasName);
    const covered = collectCovered(vectors, dim.observe);
    const uncovered = members.filter((m) => !covered.has(m));

    lines.push(`\n${dim.name}: ${members.length - uncovered.length}/${members.length} members covered by @vector`);
    if (uncovered.length > 0) {
      failed = true;
      for (const m of uncovered) {
        lines.push(`  UNCOVERED  ${m}`);
      }
    }
  }

  process.stdout.write(lines.join("\n") + "\n");

  if (failed) {
    process.stdout.write(
      "\nVector coverage gate FAILED: the members above are part of the turn engine's\n" +
        "observable TypeSpec surface but no shared @vector asserts them, so they are not\n" +
        "verified for cross-runtime parity. Add covering vectors (extending the runTurn/\n" +
        "replay seam contract where the behavior is not yet expressible).\n",
    );
    process.exit(1);
  }

  process.stdout.write("\nVector coverage gate PASSED: every observable member is covered.\n");
}

main();

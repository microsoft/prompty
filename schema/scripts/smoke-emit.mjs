/**
 * Safe emitter smoke test: emit arbitrary Typra targets to a throwaway
 * directory that has its OWN manifest, so the run can never delete the real
 * generated output under schema/tsp-output.
 *
 * Why this exists: Typra reconciles each run against
 * `<emitter-output-dir>/.typra-generated/manifest.json` and DELETES files the
 * current run does not emit. A scoped, subset-target run pointed at the shared
 * `tsp-output` dir would therefore WIPE every other target. This script always
 * points `emitter-output-dir` at a fresh temp dir, sidestepping that footgun.
 *
 * Use it to validate that the emitter produces output for targets not in the
 * canonical config (e.g. Java, Swift) without risking the committed runtimes.
 *
 * Usage:
 *   node scripts/smoke-emit.mjs                 # default: Java Swift
 *   node scripts/smoke-emit.mjs Java Swift Rust # explicit target list
 *   node scripts/smoke-emit.mjs --keep          # keep output dir for inspection
 *
 * Never point this at schema/tsp-output. Regenerate real targets only with
 * `npm run generate` (the canonical all-targets tspconfig.yaml).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const schemaDir = join(repoRoot, "schema");

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const targets = args.filter((a) => !a.startsWith("--"));
const emitTargets = targets.length > 0 ? targets : ["Java", "Swift"];

// Per-target extra options the emitter needs (Java wants a package/namespace).
const TARGET_EXTRAS = {
  Java: { namespace: "com.example.generated", "package-name": "com.example.generated" },
};

const scratch = mkdtempSync(join(tmpdir(), "prompty-smoke-emit-"));
const configPath = join(scratch, "tspconfig.smoke.yaml");

const config = {
  emit: ["@typra/emitter"],
  options: {
    "@typra/emitter": {
      "emitter-output-dir": scratch.replace(/\\/g, "/"),
      "root-object": "Prompty.Agent",
      "emit-targets": emitTargets.map((type) => ({
        type,
        "output-dir": join(scratch, type).replace(/\\/g, "/"),
        ...(TARGET_EXTRAS[type] ?? {}),
      })),
    },
  },
};

writeFileSync(configPath, stringifyYaml(config));

console.log(`smoke:emit \u2014 targets [${emitTargets.join(", ")}] \u2192 ${scratch}`);

const result = spawnSync("npx", ["tsp", "compile", "model/main.tsp", "--config", configPath], {
  cwd: schemaDir,
  shell: process.platform === "win32",
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
});

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";

function countFiles(dir) {
  let n = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) n += countFiles(join(dir, entry.name));
    else n += 1;
  }
  return n;
}

let ok = result.status === 0;

if (!ok) {
  console.error("\u2717 emitter run failed:");
  console.error(stdout.split("\n").slice(-20).join("\n"));
  console.error(stderr.split("\n").slice(-20).join("\n"));
} else {
  for (const type of emitTargets) {
    const count = countFiles(join(scratch, type));
    console.log(`  \u2713 ${type}: ${count} file(s) emitted`);
    if (count === 0) {
      ok = false;
      console.error(`  \u2717 ${type}: no files emitted`);
    }
  }
}

if (keep) {
  console.log(`(kept output at ${scratch})`);
} else {
  rmSync(scratch, { recursive: true, force: true });
}

process.exit(ok ? 0 : 1);

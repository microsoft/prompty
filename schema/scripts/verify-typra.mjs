import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const outputRel = "schema/tsp-output";
const verifierFiles = [
  ".typra-generated/export-surfaces.json",
  ".typra-generated/manifest.json",
  ".typra-generated/hydration-seams.json",
  "json-ast/model.json",
];
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const currentRoot = join(repoRoot, outputRel);

for (const file of verifierFiles) {
  const currentPath = join(currentRoot, file);
  if (!existsSync(currentPath)) {
    throw new Error(`Missing current Typra verifier input: ${currentPath}. Run npm run generate first.`);
  }
}

const baselineRoot = join(tmpdir(), `prompty-typra-baseline-${process.pid}-${Date.now()}`);
mkdirSync(baselineRoot, { recursive: true });

let hasCommittedBaseline = true;
try {
  for (const file of verifierFiles) {
    const relPath = `${outputRel}/${file}`;
    const content = execFileSync("git", ["show", `HEAD:${relPath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    mkdirSync(dirname(join(baselineRoot, file)), { recursive: true });
    writeFileSync(join(baselineRoot, file), content);
  }
} catch {
  hasCommittedBaseline = false;
}

if (!hasCommittedBaseline) {
  console.warn("No committed Typra verifier baseline found at HEAD; verified current inputs exist.");
  rmSync(baselineRoot, { recursive: true, force: true });
  process.exit(0);
}

const typraVerify =
  process.platform === "win32"
    ? join(repoRoot, "schema", "node_modules", ".bin", "typra-verify.cmd")
    : join(repoRoot, "schema", "node_modules", ".bin", "typra-verify");
const result = spawnSync(typraVerify, ["--baseline", baselineRoot, "--current", currentRoot], {
  cwd: repoRoot,
  shell: process.platform === "win32",
  stdio: "inherit",
});

rmSync(baselineRoot, { recursive: true, force: true });
process.exit(result.status ?? 1);

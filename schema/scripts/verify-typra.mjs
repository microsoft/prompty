import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const metadataRel = "schema/tsp-output/.typra-generated";
const metadataFiles = ["export-surfaces.json", "manifest.json", "hydration-seams.json"];
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const currentRoot = join(repoRoot, metadataRel);

for (const file of metadataFiles) {
  const currentPath = join(currentRoot, file);
  if (!existsSync(currentPath)) {
    throw new Error(`Missing current Typra metadata: ${currentPath}. Run npm run generate first.`);
  }
}

const baselineRoot = join(tmpdir(), `prompty-typra-baseline-${process.pid}-${Date.now()}`);
mkdirSync(baselineRoot, { recursive: true });

let hasCommittedBaseline = true;
try {
  for (const file of metadataFiles) {
    const relPath = `${metadataRel}/${file}`;
    const content = execFileSync("git", ["show", `HEAD:${relPath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    writeFileSync(join(baselineRoot, file), content);
  }
} catch {
  hasCommittedBaseline = false;
}

if (!hasCommittedBaseline) {
  console.warn("No committed Typra metadata baseline found at HEAD; verified current metadata exists.");
  rmSync(baselineRoot, { recursive: true, force: true });
  process.exit(0);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npx, ["typra-verify", "--baseline", baselineRoot, "--current", currentRoot], {
  cwd: repoRoot,
  stdio: "inherit",
});

rmSync(baselineRoot, { recursive: true, force: true });
process.exit(result.status ?? 1);

#!/usr/bin/env node
/**
 * Version bump and tag script for @prompty/* packages.
 *
 * Usage:
 *   npm run release                    # patch: 2.0.0-alpha.1 → 2.0.0-alpha.2
 *   npm run release -- --bump minor    # minor: 2.0.0-alpha.2 → 2.1.0-alpha.1
 *   npm run release -- --bump major    # major: 2.1.0-alpha.1 → 3.0.0-alpha.1
 *   npm run release -- --version 2.0.0 # explicit version (exits prerelease)
 *   npm run release -- --dry-run       # show what would happen without doing it
 *
 * What it does:
 *   1. Bumps version in all package.json files (linked)
 *   2. Commits the version bump
 *   3. Creates a git tag: prompty-ts-v{version}
 *   4. Pushes commit + tag to origin (triggers CI publish)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const repoRoot = resolve(root, "../..");

const PACKAGES = ["core", "openai", "foundry", "anthropic"];
const TAG_PREFIX = "typescript/";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function getCurrentVersion() {
  const pkg = readJson(resolve(root, "packages/core/package.json"));
  return pkg.version;
}

function bumpVersion(current, bump) {
  const preMatch = current.match(/^(\d+)\.(\d+)\.(\d+)-([a-z]+)\.(\d+)$/);
  const stableMatch = current.match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (preMatch) {
    const [, maj, min, pat, pre, preNum] = preMatch;
    const [major, minor, patch, num] = [+maj, +min, +pat, +preNum];
    switch (bump) {
      case "patch":
        return `${major}.${minor}.${patch}-${pre}.${num + 1}`;
      case "minor":
        return `${major}.${minor + 1}.0-${pre}.1`;
      case "major":
        return `${major + 1}.0.0-${pre}.1`;
      default:
        throw new Error(`Unknown bump type: ${bump}`);
    }
  } else if (stableMatch) {
    const [, maj, min, pat] = stableMatch;
    const [major, minor, patch] = [+maj, +min, +pat];
    switch (bump) {
      case "patch":
        return `${major}.${minor}.${patch + 1}`;
      case "minor":
        return `${major}.${minor + 1}.0`;
      case "major":
        return `${major + 1}.0.0`;
      default:
        throw new Error(`Unknown bump type: ${bump}`);
    }
  }
  throw new Error(`Cannot parse version: ${current}`);
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd: repoRoot, stdio: "inherit", ...opts });
}

// --- Parse args ---
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bumpIdx = args.indexOf("--bump");
const versionIdx = args.indexOf("--version");

let newVersion;
const currentVersion = getCurrentVersion();

if (versionIdx !== -1) {
  newVersion = args[versionIdx + 1];
  if (!newVersion) {
    console.error("Error: --version requires a value");
    process.exit(1);
  }
} else {
  const bump = bumpIdx !== -1 ? args[bumpIdx + 1] : "patch";
  newVersion = bumpVersion(currentVersion, bump);
}

const isPrerelease = /-/.test(newVersion);
const npmTag = isPrerelease ? "alpha" : "latest";

console.log(`\n📦 Prompty TypeScript Release`);
console.log(`   ${currentVersion} → ${newVersion}`);
console.log(`   Tag: ${TAG_PREFIX}${newVersion}`);
console.log(`   npm dist-tag: ${npmTag}\n`);

if (dryRun) {
  console.log("🏜️  Dry run — no changes made.\n");
  console.log("Files that would be updated:");
  for (const pkg of PACKAGES) {
    console.log(`  - packages/${pkg}/package.json`);
  }
  console.log(`\n`);
  process.exit(0);
}

// --- Update package.json files ---
for (const pkg of PACKAGES) {
  const pkgPath = resolve(root, `packages/${pkg}/package.json`);
  const data = readJson(pkgPath);
  data.version = newVersion;

  // Update cross-references to @prompty/* deps
  for (const depKey of ["dependencies", "peerDependencies", "devDependencies"]) {
    if (!data[depKey]) continue;
    for (const dep of Object.keys(data[depKey])) {
      if (dep.startsWith("@prompty/")) {
        data[depKey][dep] = `^${newVersion}`;
      }
    }
  }

  writeJson(pkgPath, data);
  console.log(`✅ packages/${pkg}/package.json → ${newVersion}`);
}

// --- Git commit, tag, push ---
console.log(`\n🔖 Creating commit and tag...\n`);

const files = [
  ...PACKAGES.map((p) => `runtime/typescript/packages/${p}/package.json`),
];
run(`git add ${files.join(" ")}`);
run(`git commit -m "chore(typescript): release v${newVersion}"`);
run(`git tag ${TAG_PREFIX}${newVersion}`);

console.log(`\n🚀 Pushing to origin...\n`);
run(`git push origin main --follow-tags`);

console.log(`\n✅ Done! Tag ${TAG_PREFIX}${newVersion} pushed.`);
console.log(`   CI will build, test, and publish to npm with --tag ${npmTag}.\n`);

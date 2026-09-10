# Releasing Prompty

This document describes how to publish new versions of the Prompty runtimes.

## Overview

Both runtimes use **tag-based releases**: push a GPG-signed tag, CI builds/tests/publishes
via OIDC (no secrets needed).

| Runtime | Registry | Tag format | CI workflow |
|---------|----------|------------|-------------|
| Python | [PyPI](https://pypi.org/project/prompty/) | `python/{version}` | `prompty-python.yml` |
| TypeScript | [npm](https://www.npmjs.com/package/@prompty/core) | `typescript/{version}` | `prompty-ts-release.yml` |

Those tags are produced with **release-please**, run **locally by a maintainer**
(see below). The manual tag-and-push steps later in this document remain as a
break-glass path.

## Automated releases (release-please, maintainer-run)

Prompty ships **seven runtimes independently** via
[release-please](https://github.com/googleapis/release-please). There is no shared
version number — `python/2.1.0` and `rust/2.0.3` can coexist. Config lives in
`release-please-config.json` + `.release-please-manifest.json` at the repo root.

> **Why not a CI workflow?** The `microsoft` org blocks the Actions `GITHUB_TOKEN`
> from creating pull requests, and a tag cut by `GITHUB_TOKEN` does **not** trigger
> the tag-listening publish workflows. So there is no `release-please.yml` — a
> maintainer runs the release-please **CLI locally under their own `gh` identity**.
> The org permits real users to open PRs and push tags, so this needs **no GitHub
> App, no PAT, and no org-owner approval**. A tag pushed by a real user *does*
> trigger the publish workflow.

> **VS Code extension** (`vscode/`) is intentionally **not** managed by
> release-please — it uses the Marketplace pre-release channel (`vscode/2.0.0-pre.N`)
> and keeps its own pipeline.

### Flow

```
conventional commit on main
        │
        ▼
maintainer runs `release-please manifest-pr`  ── opens/updates one "Release PR"
        │   (locally, as themselves)              per runtime with changes
        ▼                                          (title: "chore(<runtime>): release <ver>")
merge the Release PR  ── bumps version files, writes CHANGELOG
        │
        ▼
maintainer runs `release-please manifest-release`  ── pushes a tag like `python/2.1.0`
        │                                              + creates the GitHub Release
        ▼
prompty-<runtime>.yml ── existing publish workflow triggers on the tag and publishes
```

release-please **only opens PRs and cuts tags**; nothing publishes until a human
merges a Release PR *and* runs `manifest-release`. Commits route to a runtime by the
**paths they touch**; add a scope when ambiguous (`feat(python):`, `fix(rust):`).
Only `feat`, `fix`, `perf`, `revert`, `deps` trigger releases; `feat!:` /
`BREAKING CHANGE:` bumps major.

### Components

| Component  | Path                               | release-type | Version source                                       | Publish |
| ---------- | ---------------------------------- | ------------ | ---------------------------------------------------- | ------- |
| `python`   | `runtime/python/prompty`           | `python`     | `prompty/_version.py` (`# x-release-please-version`) | ✅ PyPI  |
| `rust`     | `runtime/rust`                     | `rust`       | all workspace `Cargo.toml` (native)                  | ✅ crates|
| `typescript` | `runtime/typescript/packages/core` | `node`     | all `packages/*/package.json` (`node-workspace`)     | ✅ npm   |
| `csharp`   | `runtime/csharp`                   | `simple`     | 4 `*.csproj` `<Version>` (annotated)                 | ✅ NuGet |
| `java`     | `runtime/java`                     | `simple`     | `build.gradle.kts` `version` (annotated)             | check only |
| `go`       | `runtime/go/prompty`               | `go`         | git tag only                                         | check only |
| `swift`    | `runtime/swift/prompty`            | `simple`     | git tag only                                         | check only |

Tag format (`separator:"/"`, `include-component-in-tag:true`, `include-v-in-tag:false`)
reproduces the existing `python/2.1.0` tags exactly — **no publish workflow changed**.

### Graduating beta → 2.0.0

All runtimes were on `2.0.0-beta.N`. The manifest is seeded at each runtime's last
beta with **no prerelease mode**, so the first Release PR graduates each runtime to a
clean **`2.0.0`** stable release; normal `2.0.1` / `2.1.0` / `3.0.0` bumps follow.

### Running a release (maintainer CLI)

Run from a clone where `gh auth status` shows **you** authenticated with `repo` +
`workflow` scopes. The `$(gh auth token)` below passes your identity to the CLI.

> **CRITICAL:** always pass `--config-file` **and** `--manifest-file`. Without them
> release-please ignores `release-please-config.json` and falls back to its default
> `-` tag separator, producing a bad tag like `python-2.0.0` (hyphen) that the
> publish workflow ignores. The config sets `separator:"/"` →  `python/2.0.0`.

```bash
# 1. Open / update the Release PR (safe to re-run; add --dry-run to preview)
npx --yes release-please@16 manifest-pr \
  --token="$(gh auth token)" --repo-url=microsoft/prompty --target-branch=main \
  --config-file=release-please-config.json \
  --manifest-file=.release-please-manifest.json

# 2. Merge the Release PR on GitHub (all publish checks must be green).

# 3. Cut the tag + GitHub Release, which triggers the publish workflow
npx --yes release-please@16 manifest-release \
  --token="$(gh auth token)" --repo-url=microsoft/prompty --target-branch=main \
  --config-file=release-please-config.json \
  --manifest-file=.release-please-manifest.json
```

If `manifest-release` ever produces the wrong tag, remediate deterministically:

```bash
# delete the bad release + tag, recreate the correct one at the merge commit
gh release delete "python-2.0.0" --repo microsoft/prompty --yes --cleanup-tag
gh release create "python/2.0.0" --repo microsoft/prompty \
  --target <merge-commit-sha> --title "python/2.0.0" --notes-file notes.md
```

A tag pushed this way (by you) triggers `prompty-python.yml` → PyPI publish via OIDC.

### Verify on the first Release PR (before merging)

- **typescript** — confirm all four `packages/*/package.json` versions **and** their
  `^@prompty/core` ranges bump (`node-workspace`); if a sibling is missed, register it
  as its own package in the config.
- **rust** — confirm all workspace members + `path`/`version` deps bump together.
- **csharp / java** — confirm the annotated `<Version>` / `version =` lines rewrite.
- **python** — Release PR sets `_version.py` to `2.0.0`; the built wheel is `prompty-2.0.0`.

## Pre-flight checklist (MUST DO before every release)

Run these **exact** steps locally before pushing tags. They mirror CI.
If these pass locally, CI will pass. **Do not skip this.**

### Repo hygiene pre-flight

Enable the local hook once per clone so staged files are normalized through
`.gitattributes` and whitespace errors are blocked before commit:

```bash
git config core.hooksPath .githooks
```

Before releasing, confirm the repository has no whitespace errors or tracked
CRLF files:

```bash
git diff --check
git ls-files --eol | grep 'w/crlf'  # should print nothing
```

### TypeScript pre-flight

```bash
cd runtime/typescript

# 1. Clean install from lockfile (exactly like CI)
rm -rf node_modules packages/*/node_modules packages/*/dist
# Windows: Remove-Item -Recurse -Force node_modules -EA 0; Get-ChildItem packages -Dir | % { Remove-Item -Recurse -Force "$_\node_modules","$_\dist" -EA 0 }

npm ci

# 2. Build all packages INCLUDING DTS declarations
npm run build

# 3. Run all tests
npm run test

# 4. Type-check
npm run lint
```

> **Why clean build matters**: `tsup` generates TypeScript declarations (DTS) using a
> stricter compiler mode than Vitest. Code can pass tests but fail DTS build. Always
> build from clean before tagging.

### Python pre-flight

```bash
cd runtime/python/prompty

# 1. Lint
uv run ruff check .

# 2. Format check
uv run ruff format --check .

# 3. Run tests with coverage (exact CI command)
python -m pytest tests/ -q --tb=short --cov=prompty --cov-report=term --cov-report=json
# Windows venv: .venv\Scripts\python.exe -m pytest ...
```

## Release steps

### 1. Bump versions

**Python** — edit `runtime/python/prompty/prompty/_version.py`:
```python
VERSION = "2.0.0a4"  # PEP 440: a=alpha, b=beta, rc=release candidate
```

**TypeScript** — update all 4 packages + cross-references:
```bash
cd runtime/typescript
node -e "
const fs = require('fs');
const version = '2.0.0-alpha.4';  // <-- set your version here
for (const p of ['core','openai','foundry','anthropic']) {
  const path = 'packages/' + p + '/package.json';
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  const old = pkg.version;
  pkg.version = version;
  for (const depType of ['dependencies','devDependencies','peerDependencies']) {
    if (!pkg[depType]) continue;
    for (const [k,v] of Object.entries(pkg[depType])) {
      if (k.startsWith('@prompty/') && v.includes(old)) {
        pkg[depType][k] = v.replace(old, version);
      }
    }
  }
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  console.log(p + ': ' + pkg.version);
}
"
```

### 2. Run pre-flight checks

See [Pre-flight checklist](#pre-flight-checklist-must-do-before-every-release) above.

### 3. Commit (GPG-signed)

```bash
git add -A
git commit -S -m "chore: bump versions to {version}"

# Verify signature
git log --format="%h %G? %s" -1  # must show 'G'
```

### 4. Push

```bash
git push origin main
```

### 5. Tag (GPG-signed) and push

```bash
git tag -s "python/2.0.0a4" -m "Prompty Python 2.0.0a4

<release notes>"

git tag -s "typescript/2.0.0-alpha.4" -m "Prompty TypeScript 2.0.0-alpha.4

<release notes>"

git push origin "python/2.0.0a4" "typescript/2.0.0-alpha.4"
```

### 6. Monitor CI

https://github.com/microsoft/prompty/actions

### 7. Verify published packages

```bash
# Python
pip install prompty==2.0.0a4
python -c "import prompty; print(prompty.__version__)"

# TypeScript
npm info @prompty/core versions --json | tail -5
```

## CI environment details

### TypeScript

| Workflow | Node | OS | Purpose |
|----------|------|----|---------|
| `prompty-ts-check.yml` | 22, 24 | ubuntu, windows | Test matrix |
| `prompty-ts-release.yml` | 24 | ubuntu | Publish (npm 11+ for OIDC) |

### Python

| Workflow | Python | OS | Purpose |
|----------|--------|----|---------|
| `prompty-python-check.yml` | 3.11, 3.12, 3.13 | ubuntu | Test matrix |
| `prompty-python-check.yml` | 3.11 | windows | Compat check |
| `prompty-python.yml` | 3.11 | ubuntu | Publish to PyPI |

## Packages published

### Python (single package with extras)

| Install | What you get |
|---------|-------------|
| `pip install prompty` | Core only |
| `pip install prompty[openai]` | + OpenAI provider |
| `pip install prompty[foundry]` | + Microsoft Foundry provider |
| `pip install prompty[anthropic]` | + Anthropic provider |
| `pip install prompty[jinja2]` | + Jinja2 renderer |
| `pip install prompty[all]` | Everything |

### TypeScript (separate packages)

| Package | What it is |
|---------|-----------|
| `@prompty/core` | Loader, pipeline, types, tracing |
| `@prompty/openai` | OpenAI provider |
| `@prompty/foundry` | Microsoft Foundry provider |
| `@prompty/anthropic` | Anthropic provider |

## Troubleshooting

### OIDC publish fails with 403

The trusted publisher config on the registry must match exactly:
- **Owner**: `microsoft`
- **Repository**: `prompty`
- **Workflow filename**: `prompty-python.yml` or `prompty-ts-release.yml`
- **Environment**: *(leave blank)*

### DTS build fails but tests pass

`tsup` DTS is stricter than Vitest. Common fix: `as unknown as Record<string, unknown>`.
**Always run `npm run build` from clean before tagging.**

### npm self-upgrade fails (`Cannot find module 'promise-retry'`)

Known Node 22 bug ([npm/cli#9151](https://github.com/npm/cli/issues/9151)).
Publish workflow uses Node 24 which ships npm 11 natively. Do NOT add
`npm install -g npm@latest` to any workflow.

### Python line continuation fails on Windows CI

PowerShell doesn't support `\` line continuation. Keep `run:` commands on a single line.

### Re-tagging after a failed publish

```bash
# Delete old tags
git tag -d "typescript/2.0.0-alpha.4"
git push origin :refs/tags/typescript/2.0.0-alpha.4

# Fix, commit, push
git push origin main

# Re-tag and push
git tag -s "typescript/2.0.0-alpha.4" -m "..."
git push origin "typescript/2.0.0-alpha.4"
```

> **PyPI does not allow re-uploading the same version.** If Python published but TS
> failed, only re-tag TS. If you must re-publish Python, bump to the next version.

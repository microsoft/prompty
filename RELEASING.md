# Releasing Prompty

This document describes how to publish new versions of the Prompty runtimes.

## Overview

Both runtimes use **tag-based releases**: you run a local script that bumps
versions, commits, tags, and pushes. The tag triggers a CI workflow that
builds, tests, and publishes to the package registry via OIDC (no secrets needed).

| Runtime | Registry | Tag format | Script |
|---------|----------|------------|--------|
| Python | [PyPI](https://pypi.org/project/prompty/) | `python/{version}` | `python scripts/release.py` |
| TypeScript | [npm](https://www.npmjs.com/package/@prompty/core) | `typescript/{version}` | `npm run release` |

## Python

### Prerequisites

- Push access to `microsoft/prompty`
- [PyPI trusted publisher](https://docs.pypi.org/trusted-publishers/) configured for `prompty`

### Version format

Python uses [PEP 440](https://peps.python.org/pep-0440/):
`2.0.0a1` (alpha), `2.0.0b1` (beta), `2.0.0rc1` (release candidate), `2.0.0` (stable)

### Publishing

```bash
cd runtime/python/prompty

# Preview what will happen
python scripts/release.py --dry-run

# Bump prerelease: 2.0.0a1 → 2.0.0a2
python scripts/release.py

# Bump minor: 2.0.0a2 → 2.1.0a1
python scripts/release.py --bump minor

# Bump major: 2.1.0a1 → 3.0.0a1
python scripts/release.py --bump major

# Set explicit version (e.g., exit prerelease)
python scripts/release.py --version 2.0.0
```

The script:
1. Updates `prompty/_version.py`
2. Commits: `chore(python): release v{version}`
3. Tags: `python/{version}`
4. Pushes commit + tag to origin

CI (`prompty-python.yml`) then:
1. Tests on Python 3.11/3.12/3.13 × ubuntu/macOS/windows (9 jobs)
2. Builds wheel + sdist with flit
3. Publishes to PyPI via OIDC trusted publisher

### Verify

```bash
pip install prompty==2.0.0a2
python -c "import prompty; print(prompty.__version__)"
```

## TypeScript

### Prerequisites

- Push access to `microsoft/prompty`
- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers) configured for
  `@prompty/core`, `@prompty/openai`, and `@prompty/foundry`

### Version format

TypeScript uses [semver](https://semver.org/) with prerelease:
`2.0.0-alpha.1`, `2.0.0-beta.1`, `2.0.0-rc.1`, `2.0.0`

### Publishing

```bash
cd runtime/typescript

# Preview what will happen
npm run release -- --dry-run

# Bump prerelease: 2.0.0-alpha.1 → 2.0.0-alpha.2
npm run release

# Bump minor: 2.0.0-alpha.2 → 2.1.0-alpha.1
npm run release -- --bump minor

# Bump major: 2.1.0-alpha.1 → 3.0.0-alpha.1
npm run release -- --bump major

# Set explicit version (e.g., exit prerelease)
npm run release -- --version 2.0.0
```

The script:
1. Updates all 4 `packages/*/package.json` (linked versions)
2. Updates cross-package `@prompty/*` dependency references
3. Commits: `chore(typescript): release v{version}`
4. Tags: `typescript/{version}`
5. Pushes commit + tag to origin

CI (`prompty-ts-release.yml`) then:
1. Installs, builds, and tests
2. Auto-detects npm dist-tag (`alpha` for prereleases, `latest` for stable)
3. Publishes `@prompty/core`, `@prompty/openai`, `@prompty/foundry` via OIDC

### Verify

```bash
npm info @prompty/core versions --json | tail -5
```

## Packages published

### Python (single package with extras)

| Install | What you get |
|---------|-------------|
| `pip install prompty` | Core only |
| `pip install prompty[openai]` | + OpenAI provider |
| `pip install prompty[foundry]` | + Microsoft Foundry provider |
| `pip install prompty[jinja2]` | + Jinja2 renderer |
| `pip install prompty[all]` | Everything |

### TypeScript (separate packages)

| Package | What it is |
|---------|-----------|
| `@prompty/core` | Loader, pipeline, types, tracing |
| `@prompty/openai` | OpenAI provider |
| `@prompty/foundry` | Microsoft Foundry provider |

## Troubleshooting

### OIDC publish fails with 403

The trusted publisher config on the registry must match exactly:
- **Owner**: `microsoft`
- **Repository**: `prompty`
- **Workflow filename**: `prompty-python.yml` (Python) or `prompty-ts-release.yml` (TypeScript)
- **Environment**: *(leave blank)*

### Tests pass locally but fail in CI

The CI runs `ruff check .` and `ruff format --check .` before tests.
Always run both locally before releasing:

```bash
# Python
cd runtime/python/prompty
ruff check . && ruff format --check . && python -m pytest tests/ -q

# TypeScript
cd runtime/typescript
npm run build && npm run test
```

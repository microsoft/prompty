#!/usr/bin/env python3
"""Version bump and tag script for the prompty Rust crates.

Usage:
    python scripts/release.py                    # patch: 2.0.0-alpha.8 → 2.0.0-alpha.9
    python scripts/release.py --bump minor       # minor: 2.0.0-alpha.8 → 2.1.0-alpha.1
    python scripts/release.py --bump major       # major: 2.0.0-alpha.8 → 3.0.0-alpha.1
    python scripts/release.py --version 2.0.0    # explicit version (exits prerelease)
    python scripts/release.py --dry-run          # show what would happen without doing it

What it does:
    1. Bumps version in all Cargo.toml files (package + inter-crate deps)
    2. Regenerates Cargo.lock
    3. Commits the version bump
    4. Creates a git tag: rust/{version}
    5. Pushes commit + tag to origin (triggers CI publish)
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = ROOT.parent.parent
TAG_PREFIX = "rust/"

CRATES = ["prompty", "prompty-openai", "prompty-anthropic", "prompty-foundry"]


def get_current_version() -> str:
    toml = (ROOT / "prompty" / "Cargo.toml").read_text()
    match = re.search(r'^version\s*=\s*"(.+?)"', toml, re.MULTILINE)
    if not match:
        print("Error: could not parse version from prompty/Cargo.toml", file=sys.stderr)
        sys.exit(1)
    return match.group(1)


def bump_version(current: str, bump: str) -> str:
    # Semver prerelease: 2.0.0-alpha.8
    pre_match = re.match(r"^(\d+)\.(\d+)\.(\d+)-([a-z]+)\.(\d+)$", current)
    stable_match = re.match(r"^(\d+)\.(\d+)\.(\d+)$", current)

    if pre_match:
        major, minor, patch = int(pre_match[1]), int(pre_match[2]), int(pre_match[3])
        pre_kind, pre_num = pre_match[4], int(pre_match[5])
        if bump == "patch":
            return f"{major}.{minor}.{patch}-{pre_kind}.{pre_num + 1}"
        elif bump == "minor":
            return f"{major}.{minor + 1}.0-{pre_kind}.1"
        elif bump == "major":
            return f"{major + 1}.0.0-{pre_kind}.1"
    elif stable_match:
        major, minor, patch = int(stable_match[1]), int(stable_match[2]), int(stable_match[3])
        if bump == "patch":
            return f"{major}.{minor}.{patch + 1}"
        elif bump == "minor":
            return f"{major}.{minor + 1}.0"
        elif bump == "major":
            return f"{major + 1}.0.0"

    print(f"Error: cannot parse version '{current}'", file=sys.stderr)
    sys.exit(1)


def run(cmd: str) -> None:
    print(f"  $ {cmd}")
    subprocess.run(cmd, cwd=REPO_ROOT, shell=True, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Release the prompty Rust crates")
    parser.add_argument("--bump", choices=["patch", "minor", "major"], default="patch")
    parser.add_argument("--version", dest="explicit_version", help="Explicit version (e.g., 2.0.0)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without making changes")
    args = parser.parse_args()

    current = get_current_version()

    if args.explicit_version:
        new_version = args.explicit_version
    else:
        new_version = bump_version(current, args.bump)

    is_prerelease = "-" in new_version
    tag = f"{TAG_PREFIX}{new_version}"

    print("\n📦 Prompty Rust Release")
    print(f"   {current} → {new_version}")
    print(f"   Tag: {tag}")
    print(f"   crates.io: {'prerelease' if is_prerelease else 'stable'}\n")

    if args.dry_run:
        print("🏜️  Dry run — no changes made.\n")
        print("Files that would be updated:")
        for crate in CRATES:
            print(f"  - {crate}/Cargo.toml")
        print("  - Cargo.lock")
        print()
        return

    # Update all Cargo.toml files
    for crate in CRATES:
        toml_path = ROOT / crate / "Cargo.toml"
        content = toml_path.read_text()

        # Update package version (first occurrence only)
        content = re.sub(
            r'^(version\s*=\s*)"[^"]*"',
            rf'\g<1>"{new_version}"',
            content,
            count=1,
            flags=re.MULTILINE,
        )

        # Update inter-crate dependency versions
        content = re.sub(
            r'(prompty(?:-openai)?\s*=\s*\{\s*version\s*=\s*)"[^"]*"',
            rf'\g<1>"{new_version}"',
            content,
        )

        toml_path.write_text(content)
        print(f"✅ {crate}/Cargo.toml → {new_version}")

    # Regenerate lockfile
    print("\n🔒 Regenerating Cargo.lock...")
    subprocess.run("cargo generate-lockfile", cwd=ROOT, shell=True, check=True)
    print("✅ Cargo.lock updated")

    # Git commit, tag, push
    print("\n🔖 Creating commit and tag...\n")
    files = [f"runtime/rust/{crate}/Cargo.toml" for crate in CRATES] + ["runtime/rust/Cargo.lock"]
    run(f"git add {' '.join(files)}")
    run(f'git commit -m "chore(rust): release v{new_version}"')
    run(f'git tag -a {tag} -m "{tag}"')

    print("\n🚀 Pushing to origin...\n")
    run("git push origin main --follow-tags")

    print(f"\n✅ Done! Tag {tag} pushed.")
    print("   CI will build, test, and publish to crates.io.\n")


if __name__ == "__main__":
    main()

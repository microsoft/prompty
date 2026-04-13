#!/usr/bin/env python3
"""Version bump and tag script for the Prompty C# NuGet packages.

Usage:
    python scripts/release.py                    # patch: 2.0.0-alpha.8 → 2.0.0-alpha.9
    python scripts/release.py --bump minor       # minor: 2.0.0-alpha.8 → 2.1.0-alpha.1
    python scripts/release.py --bump major       # major: 2.0.0-alpha.8 → 3.0.0-alpha.1
    python scripts/release.py --version 2.0.0    # explicit version (exits prerelease)
    python scripts/release.py --dry-run          # show what would happen without doing it

What it does:
    1. Bumps <Version> in all .csproj files
    2. Commits the version bump
    3. Creates a git tag: csharp/{version}
    4. Pushes commit + tag to origin (triggers CI publish)
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = ROOT.parent.parent
TAG_PREFIX = "csharp/"

PROJECTS = ["Prompty.Core", "Prompty.OpenAI", "Prompty.Foundry", "Prompty.Anthropic"]


def get_current_version() -> str:
    csproj = (ROOT / "Prompty.Core" / "Prompty.Core.csproj").read_text()
    match = re.search(r"<Version>(.+?)</Version>", csproj)
    if not match:
        print("Error: could not parse version from Prompty.Core.csproj", file=sys.stderr)
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
    parser = argparse.ArgumentParser(description="Release the Prompty C# NuGet packages")
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

    print("\n📦 Prompty C# Release")
    print(f"   {current} → {new_version}")
    print(f"   Tag: {tag}")
    print(f"   NuGet: {'prerelease' if is_prerelease else 'stable'}\n")

    if args.dry_run:
        print("🏜️  Dry run — no changes made.\n")
        print("Files that would be updated:")
        for proj in PROJECTS:
            print(f"  - {proj}/{proj}.csproj")
        print()
        return

    # Update all .csproj files
    for proj in PROJECTS:
        csproj_path = ROOT / proj / f"{proj}.csproj"
        content = csproj_path.read_text()
        content = re.sub(
            r"<Version>.+?</Version>",
            f"<Version>{new_version}</Version>",
            content,
        )
        csproj_path.write_text(content)
        print(f"✅ {proj}/{proj}.csproj → {new_version}")

    # Git commit, tag, push
    print("\n🔖 Creating commit and tag...\n")
    files = [f"runtime/csharp/{proj}/{proj}.csproj" for proj in PROJECTS]
    run(f"git add {' '.join(files)}")
    run(f'git commit -m "chore(csharp): release v{new_version}"')
    run(f"git tag {tag}")

    print("\n🚀 Pushing to origin...\n")
    run("git push origin main --follow-tags")

    print(f"\n✅ Done! Tag {tag} pushed.")
    print("   CI will build, test, and publish to NuGet.\n")


if __name__ == "__main__":
    main()

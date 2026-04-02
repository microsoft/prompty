#!/usr/bin/env python3
"""Version bump and tag script for the prompty Python package.

Usage:
    python scripts/release.py                    # patch: 2.0.0a1 → 2.0.0a2
    python scripts/release.py --bump minor       # minor: 2.0.0a2 → 2.1.0a1
    python scripts/release.py --bump major       # major: 2.1.0a1 → 3.0.0a1
    python scripts/release.py --version 2.0.0    # explicit version (exits prerelease)
    python scripts/release.py --dry-run          # show what would happen without doing it

What it does:
    1. Bumps version in prompty/_version.py
    2. Commits the version bump
    3. Creates a git tag: python/{version}
    4. Pushes commit + tag to origin (triggers CI publish)
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = ROOT.parent.parent.parent
VERSION_FILE = ROOT / "prompty" / "_version.py"
TAG_PREFIX = "python/"


def get_current_version() -> str:
    text = VERSION_FILE.read_text()
    match = re.search(r'VERSION\s*=\s*"(.+?)"', text)
    if not match:
        print(f"Error: could not parse version from {VERSION_FILE}", file=sys.stderr)
        sys.exit(1)
    return match.group(1)


def bump_version(current: str, bump: str) -> str:
    # PEP 440 prerelease: 2.0.0a1, 2.0.0b1, 2.0.0rc1
    pre_match = re.match(r"^(\d+)\.(\d+)\.(\d+)(a|b|rc)(\d+)$", current)
    stable_match = re.match(r"^(\d+)\.(\d+)\.(\d+)$", current)
    # dev version: 2.0.0.dev0
    dev_match = re.match(r"^(\d+)\.(\d+)\.(\d+)\.dev(\d+)$", current)

    if dev_match:
        major, minor, patch, _dev_num = int(dev_match[1]), int(dev_match[2]), int(dev_match[3]), int(dev_match[4])
        # dev → alpha
        if bump == "patch":
            return f"{major}.{minor}.{patch}a1"
        elif bump == "minor":
            return f"{major}.{minor + 1}.0a1"
        elif bump == "major":
            return f"{major + 1}.0.0a1"
    elif pre_match:
        major, minor, patch = int(pre_match[1]), int(pre_match[2]), int(pre_match[3])
        pre_kind, pre_num = pre_match[4], int(pre_match[5])
        if bump == "patch":
            return f"{major}.{minor}.{patch}{pre_kind}{pre_num + 1}"
        elif bump == "minor":
            return f"{major}.{minor + 1}.0{pre_kind}1"
        elif bump == "major":
            return f"{major + 1}.0.0{pre_kind}1"
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
    parser = argparse.ArgumentParser(description="Release the prompty Python package")
    parser.add_argument("--bump", choices=["patch", "minor", "major"], default="patch")
    parser.add_argument("--version", dest="explicit_version", help="Explicit version (e.g., 2.0.0)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without making changes")
    args = parser.parse_args()

    current = get_current_version()

    if args.explicit_version:
        new_version = args.explicit_version
    else:
        new_version = bump_version(current, args.bump)

    is_prerelease = re.search(r"(a|b|rc|dev)", new_version) is not None
    tag = f"{TAG_PREFIX}{new_version}"

    print("\n📦 Prompty Python Release")
    print(f"   {current} → {new_version}")
    print(f"   Tag: {tag}")
    print(f"   PyPI: {'prerelease' if is_prerelease else 'stable'}\n")

    if args.dry_run:
        print("🏜️  Dry run — no changes made.\n")
        print("Files that would be updated:")
        print("  - prompty/_version.py")
        print()
        return

    # Update _version.py
    VERSION_FILE.write_text(f'VERSION = "{new_version}"\n')
    print(f"✅ prompty/_version.py → {new_version}")

    # Git commit, tag, push
    print("\n🔖 Creating commit and tag...\n")
    run("git add runtime/python/prompty/prompty/_version.py")
    run(f'git commit -m "chore(python): release v{new_version}"')
    run(f"git tag {tag}")

    print("\n🚀 Pushing to origin...\n")
    run("git push origin main --follow-tags")

    print(f"\n✅ Done! Tag {tag} pushed.")
    print("   CI will build, test, and publish to PyPI.\n")


if __name__ == "__main__":
    main()

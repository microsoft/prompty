#!/usr/bin/env python3
"""Audit documentation pages for multi-language code coverage.

Scans all .mdx files under web/src/content/docs/ and reports which
programming languages have code examples on each page. Exits non-zero
if any page that should have all languages is missing one.

Usage:
    python scripts/audit-language-coverage.py [--ci]

Flags:
    --ci   Strict mode — exit 1 if any page is missing a language.
           Without --ci, prints the report and always exits 0.

Configuration:
    Edit LANGUAGES to add or remove tracked languages.
    Edit SINGLE_LANGUAGE_PAGES for pages intentionally covering one language.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# ── Configuration ────────────────────────────────────────────────────

LANGUAGES = {
    "python": re.compile(r"```(?:python|py|bash\b.*pip|bash\b.*uv )", re.IGNORECASE),
    "typescript": re.compile(r"```(?:typescript|ts|javascript|js|bash\b.*npm)", re.IGNORECASE),
    "csharp": re.compile(r"```(?:csharp|cs|bash\b.*dotnet)", re.IGNORECASE),
}

# Pages that are intentionally single-language (relative to docs root).
# These are excluded from the "missing language" report.
SINGLE_LANGUAGE_PAGES = {
    "implementation/python.mdx",
    "implementation/typescript.mdx",
    "implementation/csharp.mdx",
    "vscode/reference.mdx",
    "vscode/running.mdx",
}

# Pages where code blocks are config/YAML only (no language code expected).
CONFIG_ONLY_PAGES = {
    "vscode/connections.mdx",
}

# Directory prefixes to exclude entirely (e.g., legacy v1 docs, spec pseudocode).
EXCLUDED_PREFIXES = (
    "legacy/",
    "specification/",
)

# ── Scanner ──────────────────────────────────────────────────────────

DOCS_ROOT = Path(__file__).resolve().parent.parent / "src" / "content" / "docs"


def scan_page(path: Path) -> dict[str, bool]:
    """Return {language: True/False} for detected code blocks."""
    text = path.read_text(encoding="utf-8")
    return {lang: bool(pattern.search(text)) for lang, pattern in LANGUAGES.items()}


def relative(path: Path) -> str:
    return str(path.relative_to(DOCS_ROOT)).replace("\\", "/")


def main() -> int:
    ci_mode = "--ci" in sys.argv

    pages: list[tuple[str, dict[str, bool]]] = []
    for mdx in sorted(DOCS_ROOT.rglob("*.mdx")):
        rel = relative(mdx)
        if rel.startswith("_"):
            continue
        coverage = scan_page(mdx)
        if any(coverage.values()):
            pages.append((rel, coverage))

    if not pages:
        print("No .mdx pages with code blocks found.")
        return 0

    # Categorize
    full_coverage = []
    missing = []
    skipped = []

    for rel, coverage in pages:
        if rel in SINGLE_LANGUAGE_PAGES or rel in CONFIG_ONLY_PAGES:
            skipped.append((rel, coverage))
            continue
        if rel.startswith(EXCLUDED_PREFIXES):
            skipped.append((rel, coverage))
            continue
        missing_langs = [lang for lang, found in coverage.items() if not found]
        if missing_langs:
            missing.append((rel, missing_langs))
        else:
            full_coverage.append(rel)

    # Report
    all_langs = ", ".join(LANGUAGES.keys())
    print(f"\n📊 Documentation Language Coverage Audit ({all_langs})")
    print("=" * 70)

    print(f"\n✅ Full coverage ({len(full_coverage)} pages):")
    for rel in full_coverage:
        print(f"   {rel}")

    if skipped:
        print(f"\n⏭️  Intentionally single-language ({len(skipped)} pages):")
        for rel, coverage in skipped:
            langs = [l for l, v in coverage.items() if v]
            print(f"   {rel} [{', '.join(langs)}]")

    if missing:
        print(f"\n❌ Missing languages ({len(missing)} pages):")
        for rel, langs in missing:
            print(f"   {rel} — missing: {', '.join(langs)}")
    else:
        print("\n🎉 All pages have full language coverage!")

    print(f"\n{'=' * 70}")
    print(f"Total: {len(pages)} pages with code | {len(full_coverage)} full | {len(skipped)} skipped | {len(missing)} missing")

    if ci_mode and missing:
        print("\n💥 CI mode: failing due to missing language coverage.")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

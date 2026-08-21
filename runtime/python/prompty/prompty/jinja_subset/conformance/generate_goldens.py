"""Generate Prompty Jinja Subset conformance goldens from the Python reference.

Reads ``corpus.json`` and, using :mod:`prompty.jinja_subset` as the oracle,
writes three golden files next to it:

- ``render_golden.json`` — template + inputs → rendered string (or strict throw).
- ``ast_golden.json``    — template → parse AST (input-independent).
- ``segments_golden.json`` — provenance-tagged segments for injection/strict cases.

It also **cross-checks** every ``jinja2_agrees`` claim against stock ``jinja2``:
for agreeing cases the reference render MUST equal jinja2's; for divergent cases
it MUST differ. Any inconsistency is reported and fails the run, so the corpus
cannot silently drift from the portable floor.

Run:
    python -m prompty.jinja_subset.conformance.generate_goldens
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from prompty.jinja_subset import StrictViolation, parse_template, render, render_segments

_HERE = Path(__file__).parent
_CORPUS = _HERE / "corpus.json"


def _jinja2_render(template: str, inputs: dict[str, Any]) -> str:
    from jinja2 import DictLoader
    from jinja2.sandbox import ImmutableSandboxedEnvironment

    env = ImmutableSandboxedEnvironment(
        loader=DictLoader({"prompt": template}),
        keep_trailing_newline=True,
    )
    return env.get_template("prompt").render(**inputs)


def _load_corpus() -> list[dict[str, Any]]:
    data = json.loads(_CORPUS.read_text(encoding="utf-8"))
    return data["cases"]


def generate() -> tuple[list[str], dict[str, list[dict[str, Any]]]]:
    """Return (problems, goldens). ``problems`` empty means the corpus is sound."""
    cases = _load_corpus()
    problems: list[str] = []
    render_golden: list[dict[str, Any]] = []
    ast_golden: list[dict[str, Any]] = []
    segments_golden: list[dict[str, Any]] = []

    for case in cases:
        name = case["name"]
        template = case["template"]
        inputs = case.get("inputs", {})
        strict_props = case.get("strict_props")
        expect_throw = case.get("expect_throw", False)

        # --- AST golden (always) ---
        ast_golden.append({"name": name, "template": template, "ast": parse_template(template)})

        # --- render golden ---
        entry: dict[str, Any] = {"name": name, "template": template, "inputs": inputs}
        if strict_props:
            entry["strict_props"] = strict_props

        threw = False
        rendered: str | None = None
        try:
            rendered = render(template, inputs, strict_props=strict_props)
        except StrictViolation:
            threw = True

        if expect_throw:
            if not threw:
                problems.append(f"{name}: expected StrictViolation but render succeeded -> {rendered!r}")
            entry["throws"] = "StrictViolation"
        else:
            if threw:
                problems.append(f"{name}: unexpected StrictViolation")
                continue
            entry["rendered"] = rendered

        render_golden.append(entry)

        # --- jinja2 cross-check (skip strict-throw cases) ---
        if not expect_throw and "jinja2_agrees" in case:
            try:
                j2 = _jinja2_render(template, inputs)
            except Exception as exc:  # noqa: BLE001 - report, don't crash
                problems.append(f"{name}: jinja2 raised {type(exc).__name__}: {exc}")
            else:
                agrees = case["jinja2_agrees"]
                if agrees and j2 != rendered:
                    problems.append(f"{name}: jinja2_agrees=true but reference {rendered!r} != jinja2 {j2!r}")
                if not agrees and j2 == rendered:
                    problems.append(f"{name}: jinja2_agrees=false but reference matches jinja2 ({rendered!r})")

        # --- segments golden (provenance-bearing categories) ---
        if case.get("category") in ("injection", "strict"):
            seg_entry: dict[str, Any] = {"name": name, "template": template, "inputs": inputs}
            if strict_props:
                seg_entry["strict_props"] = strict_props
            if expect_throw:
                seg_entry["throws"] = "StrictViolation"
            else:
                seg_entry["segments"] = [asdict(s) for s in render_segments(template, inputs, strict_props=strict_props)]
            segments_golden.append(seg_entry)

    goldens = {
        "render_golden.json": render_golden,
        "ast_golden.json": ast_golden,
        "segments_golden.json": segments_golden,
    }
    return problems, goldens


def main() -> int:
    problems, goldens = generate()
    for fname, data in goldens.items():
        (_HERE / fname).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {fname}: {len(data)} entries")
    if problems:
        print(f"\n{len(problems)} corpus problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("\ncorpus sound: all jinja2_agrees claims verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

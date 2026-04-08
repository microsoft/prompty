"""Validate that every .prompty file in docs-examples/prompts/ loads without error.

This is the first line of defense against docs rot — if a .prompty file
has invalid YAML, wrong property names, or broken ${env:} references,
this test catches it.
"""
from __future__ import annotations

import glob
import os
from pathlib import Path

import pytest

from prompty import load

PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"
PROMPTY_FILES = sorted(glob.glob(str(PROMPTS_DIR / "*.prompty")))


@pytest.mark.parametrize("path", PROMPTY_FILES, ids=lambda p: os.path.basename(p))
def test_prompty_loads(path: str) -> None:
    """Each .prompty file should load into a valid Prompty object."""
    agent = load(path)
    assert agent.name, f"Missing 'name' in {path}"

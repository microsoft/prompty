"""Shared OpenAI reasoning-guard conformance vectors for the reference runtime.

The TypeScript, Rust, and C# ports read the same fixture. This test keeps the
Python implementation, which defines the policy, on the same contract.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path
from typing import Any

import pytest

from prompty.model import Agent
from prompty.providers.openai.executor import _BaseExecutor

VECTORS = json.loads(
    (Path(__file__).resolve().parents[4] / "schema/model/conformance/openai-reasoning-guard.json").read_text(
        encoding="utf-8"
    )
)
BUILDERS = {
    "chat": _BaseExecutor._build_chat_args,
    "responses": _BaseExecutor._build_responses_args,
}


def _agent(vector: dict[str, Any]) -> Agent:
    return Agent.load(
        {
            "name": "guard",
            "model": {
                "id": vector["model"],
                "provider": "openai",
                "options": vector["options"],
            },
        }
    )


@pytest.mark.parametrize("vector", VECTORS, ids=[vector["name"] for vector in VECTORS])
@pytest.mark.parametrize("builder", sorted(BUILDERS))
def test_shared_execution_reasoning_guards(vector: dict[str, Any], builder: str) -> None:
    agent = _agent(vector)
    before = agent.model.options.to_wire("openai")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        args = BUILDERS[builder](_BaseExecutor.__new__(_BaseExecutor), agent, [])
    for key in vector["absent"]:
        assert key not in args, f"{vector['name']} {builder}: unexpected {key}"
    for key, expected in vector["present"].items():
        assert args[key] == expected, f"{vector['name']} {builder}: {key}"
    # The generated mapper stays rename-only; the guard never edits source options.
    assert agent.model.options.to_wire("openai") == before

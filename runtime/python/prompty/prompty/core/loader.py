"""Prompty loader — loads .prompty files into typed Prompty objects.

The loader splits frontmatter (YAML) from the markdown body, resolves
``${protocol:value}`` references (env vars, file includes), and
delegates to ``Prompty.load()`` from the generated model package.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

from ..model import LoadContext, Prompty, SaveContext
from .utils import load_prompty, load_prompty_async

__all__ = ["load", "load_async", "default_save_context"]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load(path: str | Path) -> Prompty:
    """Load a ``.prompty`` file and return a typed ``Prompty``.

    Parameters
    ----------
    path:
        File system path to a ``.prompty`` file.

    Returns
    -------
    Prompty
        Fully typed prompt definition.
    """
    path = Path(path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Prompty file not found: {path}")

    # 1. Split frontmatter + body
    data = load_prompty(path)

    # 2–7 shared pipeline
    return _build_agent(data, path)


async def load_async(path: str | Path) -> Prompty:
    """Async variant of :func:`load`."""
    path = Path(path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Prompty file not found: {path}")

    data = await load_prompty_async(path)
    return _build_agent(data, path)


def default_save_context(**kwargs: Any) -> SaveContext:
    """Return a ``SaveContext`` that strips internal ``__``-prefixed metadata keys.

    This is the save-side counterpart to the ``LoadContext`` used during
    :func:`load`. Pass it to ``agent.save()``, ``agent.to_yaml()``, or
    ``agent.to_json()`` to keep serialised output clean.
    """

    def _strip_internals(data: dict[str, Any]) -> dict[str, Any]:
        meta = data.get("metadata")
        if isinstance(meta, dict):
            cleaned = {k: v for k, v in meta.items() if not k.startswith("__")}
            if cleaned:
                data["metadata"] = cleaned
            else:
                data.pop("metadata", None)
        return data

    return SaveContext(post_save=_strip_internals, **kwargs)


# ---------------------------------------------------------------------------
# Internal pipeline
# ---------------------------------------------------------------------------


def _build_agent(data: dict[str, Any] | str, path: Path) -> Prompty:
    """Shared pipeline that transforms raw frontmatter dict into a Prompty."""

    # Handle body-only files (no frontmatter — parse returns a string)
    if isinstance(data, str):
        data = {"instructions": data}
    if not isinstance(data, dict):
        data = {}

    # 2. Load via Prompty.load() with pre_process for ${protocol:value} expansion
    ctx = LoadContext(pre_process=_pre_process(path))
    agent = Prompty.load(data, ctx)

    # Store source path for PromptyTool resolution (relative path lookups)
    if agent.metadata is None:
        agent.metadata = {}
    agent.metadata["__source_path"] = str(path)

    return agent


# ---------------------------------------------------------------------------
# Reference resolution via pre_process
# ---------------------------------------------------------------------------


def _pre_process(agent_file: Path) -> Callable[[Any], Any]:
    """Return a ``pre_process`` callback that resolves ``${protocol:value}``
    references in every dict the loader visits.

    Supported protocols:

    * ``${env:VAR_NAME}`` — environment variable (required)
    * ``${env:VAR_NAME:default}`` — environment variable with default
    * ``${file:relative/path}`` — load file content (JSON / YAML / text)
    """

    def process(data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        for key, value in list(data.items()):
            if not isinstance(value, str) or not value.startswith("${"):
                continue

            # Must end with }
            if not value.endswith("}"):
                continue

            inner = value[2:-1]
            protocol, _, val = inner.partition(":")
            protocol = protocol.lower()

            if protocol == "env":
                # Support ${env:VAR:default}
                var_name, _, default = val.partition(":")
                env_val = os.environ.get(var_name)
                if env_val is None:
                    if default:
                        data[key] = default
                    else:
                        raise ValueError(f"Environment variable '{var_name}' not set for key '{key}'")
                else:
                    data[key] = env_val

            elif protocol == "file":
                relative_path = (agent_file.parent / val).resolve()
                if not relative_path.exists():
                    raise FileNotFoundError(
                        f"Referenced file '{val}' not found for key '{key}' (resolved to {relative_path})"
                    )
                data[key] = _load_file_content(relative_path)

        return data

    return process


def _load_file_content(path: Path) -> Any:
    """Load a file as JSON, YAML, or plain text based on its extension."""
    with open(path, encoding="utf-8") as f:
        if path.suffix == ".json":
            return json.load(f)
        elif path.suffix in (".yml", ".yaml"):
            return yaml.safe_load(f)
        else:
            return f.read()

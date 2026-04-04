"""Prompty chat parser — splits rendered text into abstract messages.

Recognizes role markers (``system:``, ``user:``, ``assistant:``, ``developer:``).
Supports nonce-based sanitization when ``FormatConfig.strict`` is enabled.

Images should be passed via ``kind: image`` input properties rather than
inline markdown syntax. Inline ``![alt](url)`` is preserved as literal text.

Registered as ``prompty`` in ``prompty.parsers``.
"""

from __future__ import annotations

import re
import secrets
from pathlib import Path
from typing import Any

from ..core.types import (
    ROLES,
    Message,
    TextPart,
)
from ..model import Prompty
from ..tracing.tracer import trace

__all__ = ["PromptyChatParser"]

# Role boundary regex — matches lines like ``system:`` or ``user[name="Alice"]:``
_ROLE_NAMES = "|".join(sorted(ROLES))
_BOUNDARY_RE = re.compile(
    r"(?im)^\s*#?\s*(" + _ROLE_NAMES + r")"
    r"(\[((\w+\s*=\s*\"?[^\"]*\"?\s*,?\s*)+)\])?\s*:\s*$"
)


class PromptyChatParser:
    """Parses rendered prompt text into a list of ``Message``.

    Supports optional nonce-based pre-render sanitization to prevent
    template variables from injecting structural role markers when
    ``FormatConfig.strict`` is enabled.
    """

    # ---- pre_render (optional sanitization) ----

    def pre_render(self, template: str) -> tuple[str, dict[str, Any]]:
        """Inject nonces into role markers before template rendering.

        This prevents user-controlled template variables from injecting
        extra role boundaries (prompt injection defense).

        Returns ``(sanitized_template, context)`` where context contains
        the nonce for later validation in ``parse()``.
        """
        nonce = secrets.token_hex(8)
        sanitized_lines: list[str] = []

        for line in template.splitlines(keepends=True):
            stripped = line.strip()

            m = _BOUNDARY_RE.match(stripped)
            if m:
                role = m.group(1).strip().lower()
                # Inject nonce as an attribute
                sanitized_lines.append(f'{role}[nonce="{nonce}"]:\n')
            else:
                sanitized_lines.append(line)

        return "".join(sanitized_lines), {"nonce": nonce}

    # ---- parse ----

    @trace
    def parse(
        self,
        agent: Prompty,
        rendered: str,
        **context: Any,
    ) -> list[Message]:
        """Parse rendered text into an abstract message array.

        Parameters
        ----------
        agent:
            The loaded Prompty (used for resolving file paths).
        rendered:
            The rendered template text.
        **context:
            Optional ``nonce`` from ``pre_render()`` for strict validation.

        Returns
        -------
        list[Message]
        """
        return self._parse(agent, rendered, **context)

    def _parse(
        self,
        agent: Prompty,
        rendered: str,
        **context: Any,
    ) -> list[Message]:
        nonce = context.get("nonce")
        base_path = self._resolve_base_path(agent)
        return list(self._parse_messages(rendered, nonce, base_path))

    @trace
    async def parse_async(
        self,
        agent: Prompty,
        rendered: str,
        **context: Any,
    ) -> list[Message]:
        return self._parse(agent, rendered, **context)

    # ---- internal parsing ----

    def _resolve_base_path(self, agent: Prompty) -> Path | None:
        """Try to find a base path from agent metadata for resolving relative images."""
        # The agent doesn't store the file path directly, but metadata may have it
        if agent.metadata and "source_path" in agent.metadata:
            return Path(agent.metadata["source_path"]).parent
        return None

    def _parse_messages(
        self,
        text: str,
        nonce: str | None,
        base_path: Path | None,
    ):
        """Generator that yields Message / ThreadMarker from rendered text."""
        content_buffer: list[str] = []
        role = "system"  # default role if none specified
        attrs: dict[str, Any] = {}
        has_boundary = False  # tracks if current segment started with a role marker

        for line in text.splitlines():
            stripped = line.strip()

            # Role boundary
            m = _BOUNDARY_RE.match(stripped)
            if m:
                if content_buffer:
                    yield self._build_message(role, content_buffer, attrs, nonce if has_boundary else None, base_path)
                    content_buffer = []

                role = m.group(1).strip().lower()
                raw_attrs = m.group(2)  # e.g. [name="Alice",nonce="abc"]
                attrs = self._parse_attrs(raw_attrs) if raw_attrs else {}
                has_boundary = True
                continue

            content_buffer.append(line)

        # Flush remaining content
        if content_buffer:
            yield self._build_message(role, content_buffer, attrs, nonce if has_boundary else None, base_path)

    def _build_message(
        self,
        role: str,
        lines: list[str],
        attrs: dict[str, Any],
        nonce: str | None,
        base_path: Path | None,
    ) -> Message:
        """Build a Message from accumulated content lines."""
        # Strip leading/trailing blank lines from content
        content = "\n".join(lines)
        content = content.strip("\n")

        # Validate nonce in strict mode
        if nonce is not None:
            msg_nonce = attrs.pop("nonce", None)
            if msg_nonce != nonce:
                raise ValueError(
                    "Nonce mismatch — possible prompt injection detected "
                    "(strict mode is enabled). A template variable may be "
                    "injecting role markers."
                )

        parts = [TextPart(value=content)]

        # Remaining attrs become metadata
        metadata = {k: v for k, v in attrs.items() if k != "nonce"}

        return Message(role=role, parts=parts, metadata=metadata)

    def _parse_attrs(self, raw: str) -> dict[str, Any]:
        """Parse ``[key="value", key2=value2]`` attribute strings."""
        # Strip surrounding brackets
        inner = raw.strip("[]")

        result: dict[str, Any] = {}
        # Match key=value pairs
        pattern = r'(\w+)\s*=\s*"?([^",]*)"?'
        for m in re.finditer(pattern, inner):
            key = m.group(1)
            val_str = m.group(2).strip()
            # Type coercion
            if val_str.lower() in ("true", "false"):
                result[key] = val_str.lower() == "true"
            else:
                try:
                    result[key] = int(val_str)
                except ValueError:
                    try:
                        result[key] = float(val_str)
                    except ValueError:
                        result[key] = val_str

        return result

"""Prompty chat parser — splits rendered text into abstract messages.

Recognizes role markers (``system:``, ``user:``, ``assistant:``, ``developer:``)
and inline markdown images. Supports nonce-based sanitization when
``Format.strict`` is enabled.

Registered as ``prompty`` in ``prompty.parsers``.
"""

from __future__ import annotations

import base64
import re
import secrets
from pathlib import Path
from typing import Any

from agentschema import PromptAgent

from .tracer import trace
from .types import (
    ROLES,
    ContentPart,
    ImagePart,
    Message,
    TextPart,
)

__all__ = ["PromptyChatParser"]

# Role boundary regex — matches lines like ``system:`` or ``user[name="Alice"]:``
_ROLE_NAMES = "|".join(sorted(ROLES))
_BOUNDARY_RE = re.compile(
    r"(?im)^\s*#?\s*(" + _ROLE_NAMES + r")"
    r"(\[((\w+\s*=\s*\"?[^\"]*\"?\s*,?\s*)+)\])?\s*:\s*$"
)

# Markdown image regex — ``![alt](url)``
_IMAGE_RE = re.compile(
    r"(?P<alt>!\[[^\]]*\])\((?P<filename>[^\s\)]+)(?:\s+[^\)]*)?\)", re.MULTILINE
)


class PromptyChatParser:
    """Parses rendered prompt text into a list of ``Message``.

    Supports optional nonce-based pre-render sanitization to prevent
    template variables from injecting structural role markers when
    ``Format.strict`` is enabled.
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
        agent: PromptAgent,
        rendered: str,
        **context: Any,
    ) -> list[Message]:
        """Parse rendered text into an abstract message array.

        Parameters
        ----------
        agent:
            The loaded PromptAgent (used for resolving file paths).
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
        agent: PromptAgent,
        rendered: str,
        **context: Any,
    ) -> list[Message]:
        nonce = context.get("nonce")
        base_path = self._resolve_base_path(agent)
        return list(self._parse_messages(rendered, nonce, base_path))

    @trace
    async def parse_async(
        self,
        agent: PromptAgent,
        rendered: str,
        **context: Any,
    ) -> list[Message]:
        return self._parse(agent, rendered, **context)

    # ---- internal parsing ----

    def _resolve_base_path(self, agent: PromptAgent) -> Path | None:
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

        for line in text.splitlines():
            stripped = line.strip()

            # Role boundary
            m = _BOUNDARY_RE.match(stripped)
            if m:
                if content_buffer:
                    yield self._build_message(
                        role, content_buffer, attrs, nonce, base_path
                    )
                    content_buffer = []

                role = m.group(1).strip().lower()
                raw_attrs = m.group(2)  # e.g. [name="Alice",nonce="abc"]
                attrs = self._parse_attrs(raw_attrs) if raw_attrs else {}
                continue

            content_buffer.append(line)

        # Flush remaining content
        if content_buffer:
            yield self._build_message(role, content_buffer, attrs, nonce, base_path)

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

        # Parse content for inline images
        parts = self._parse_content(content, base_path)

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

    def _parse_content(self, content: str, base_path: Path | None) -> list[ContentPart]:
        """Parse content string into ContentPart list, handling inline images."""
        matches = list(_IMAGE_RE.finditer(content))

        if not matches:
            return [TextPart(value=content)]

        parts: list[ContentPart] = []
        last_end = 0

        for m in matches:
            # Text before this image
            before = content[last_end : m.start()].strip()
            if before:
                parts.append(TextPart(value=before))

            # Image
            filename = m.group("filename").split(" ")[0].strip()
            source = self._resolve_image(filename, base_path)
            parts.append(ImagePart(source=source))

            last_end = m.end()

        # Text after the last image
        after = content[last_end:].strip()
        if after:
            parts.append(TextPart(value=after))

        return parts

    def _resolve_image(self, image_ref: str, base_path: Path | None) -> str:
        """Resolve an image reference to a URL or data URI.

        URLs and data URIs pass through unchanged. Local file paths
        are base64-encoded into data URIs.
        """
        if image_ref.startswith(("http://", "https://", "data:")):
            return image_ref

        # Local file — resolve and base64 encode
        if base_path is not None:
            image_path = base_path / image_ref
        else:
            image_path = Path(image_ref)

        if not image_path.exists():
            # Return as-is if we can't resolve
            return image_ref

        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")

        suffix = image_path.suffix.lower()
        mime_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
        }
        mime = mime_map.get(suffix, "application/octet-stream")
        return f"data:{mime};base64,{b64}"

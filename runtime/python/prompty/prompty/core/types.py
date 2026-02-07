"""Abstract message types for model-agnostic prompt representation.

The parser produces these types. Executors transform them into
provider-specific wire format (OpenAI, Anthropic, etc.).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "ContentPart",
    "ImagePart",
    "FilePart",
    "AudioPart",
    "TextPart",
    "Message",
    "ThreadMarker",
    "RICH_KINDS",
    "ROLES",
]

# Rich input kinds that the renderer handles structurally (not as text).
RICH_KINDS = frozenset({"thread", "image", "file", "audio"})

# Supported role markers that the parser recognizes.
ROLES = frozenset({"system", "user", "assistant", "developer"})


# ---------------------------------------------------------------------------
# Content parts
# ---------------------------------------------------------------------------


@dataclass
class ContentPart:
    """Base class for typed content within a message.

    Each part has a ``kind`` discriminator and part-specific fields.
    """

    kind: str


@dataclass
class TextPart(ContentPart):
    """Plain text content."""

    kind: str = field(default="text", init=False)
    value: str = ""


@dataclass
class ImagePart(ContentPart):
    """Image content — URL, data URI, or file path.

    Attributes:
        source: URL, ``data:`` URI, or file path to the image.
        detail: Processing detail level (``"auto"``, ``"low"``, ``"high"``).
        media_type: MIME type (e.g. ``"image/png"``). Inferred if omitted.
    """

    kind: str = field(default="image", init=False)
    source: str = ""
    detail: str | None = None
    media_type: str | None = None


@dataclass
class FilePart(ContentPart):
    """File/document attachment (PDF, etc.).

    Attributes:
        source: URL or file path.
        media_type: MIME type (e.g. ``"application/pdf"``).
    """

    kind: str = field(default="file", init=False)
    source: str = ""
    media_type: str | None = None


@dataclass
class AudioPart(ContentPart):
    """Audio content.

    Attributes:
        source: URL, ``data:`` URI, or file path.
        media_type: MIME type (e.g. ``"audio/wav"``).
    """

    kind: str = field(default="audio", init=False)
    source: str = ""
    media_type: str | None = None


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


@dataclass
class Message:
    """A single message in the abstract message array.

    Attributes:
        role: One of the recognized roles (system, user, assistant, developer).
        parts: Ordered list of content parts.
        metadata: Extra key-value pairs from role boundary args
            (e.g. ``name``, custom attributes).
    """

    role: str
    parts: list[ContentPart] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def text(self) -> str:
        """Convenience: concatenate all TextPart values."""
        return "".join(p.value for p in self.parts if isinstance(p, TextPart))

    def to_text_content(self) -> str | list[dict[str, Any]]:
        """Return plain string if all parts are text, else a parts list.

        This is useful for simple serialization — callers that only need
        the text content can get a ``str``, while multimodal messages
        get the full parts array.
        """
        if all(isinstance(p, TextPart) for p in self.parts):
            return self.text
        return [_part_to_dict(p) for p in self.parts]


@dataclass
class ThreadMarker:
    """Positional marker for thread (conversation history) insertion.

    Emitted by the parser when it encounters a thread-kind input variable.
    ``prepare()`` replaces these with actual messages from the ``thread``
    input.

    Attributes:
        name: The input property name (e.g. ``"conversation"``).
    """

    name: str = "thread"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _part_to_dict(part: ContentPart) -> dict[str, Any]:
    """Convert a ContentPart to a plain dict."""
    if isinstance(part, TextPart):
        return {"kind": "text", "value": part.value}
    elif isinstance(part, ImagePart):
        d: dict[str, Any] = {"kind": "image", "source": part.source}
        if part.detail is not None:
            d["detail"] = part.detail
        if part.media_type is not None:
            d["mediaType"] = part.media_type
        return d
    elif isinstance(part, FilePart):
        d = {"kind": "file", "source": part.source}
        if part.media_type is not None:
            d["mediaType"] = part.media_type
        return d
    elif isinstance(part, AudioPart):
        d = {"kind": "audio", "source": part.source}
        if part.media_type is not None:
            d["mediaType"] = part.media_type
        return d
    else:
        return {"kind": part.kind}

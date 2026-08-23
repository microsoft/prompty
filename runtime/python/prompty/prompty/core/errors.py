"""Typed load-time errors carrying a stable ``kind`` discriminator.

The ``kind`` lets callers — and the conformance harness — branch on the
failure category without matching on human-readable message text. This
mirrors the typed load-error taxonomies already present in the Rust
(``LoadError``), Java (``LoadException.Kind``), Swift (``LoadError``), and
Go (``LoadError``) runtimes.
"""

from __future__ import annotations

__all__ = ["PromptyLoadError"]


class PromptyLoadError(ValueError):
    """A ``.prompty`` load failure with a stable ``kind`` discriminator.

    Subclasses :class:`ValueError` so existing callers that catch
    ``ValueError`` continue to work unchanged.

    Attributes
    ----------
    kind:
        Stable machine-readable failure category (e.g. ``env_var_not_set``,
        ``file_reference``, ``invalid_template``, ``missing_required_input``).
    field:
        Optional input/field name the error refers to (used by
        ``missing_required_input``).
    """

    def __init__(self, kind: str, message: str, *, field: str | None = None) -> None:
        super().__init__(message)
        self.kind = kind
        self.field = field

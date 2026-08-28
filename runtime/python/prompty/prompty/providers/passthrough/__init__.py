"""Passthrough (NOOP) provider implementations.

Provides :class:`PassthroughProcessor`, the processor-axis default. A provider
that registers only an ``Executor`` gets passthrough processing automatically —
the raw provider response is returned unchanged, with no extraction. An explicit
per-key processor (registered or discovered) always shadows this default.
"""

from __future__ import annotations

from .processor import PassthroughProcessor

__all__ = ["PassthroughProcessor"]

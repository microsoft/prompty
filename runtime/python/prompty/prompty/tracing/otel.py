"""
OpenTelemetry trace backend for Prompty.

Provides an OTel-compatible backend that plugs into the Tracer registry,
emitting spans with dotted-key attribute expansion.

Requires ``opentelemetry-api`` — install via ``pip install prompty[otel]``.

Usage::

    from prompty import Tracer
    from prompty.tracing.otel import otel_tracer

    Tracer.add("otel", otel_tracer())
    # or with a custom tracer name:
    Tracer.add("otel", otel_tracer(tracer_name="my.app"))
"""

from __future__ import annotations

import contextlib
import json
import traceback
from collections.abc import Callable, Iterator
from typing import TYPE_CHECKING, Any

from opentelemetry import trace as otel_trace
from opentelemetry.trace import Span, Status, StatusCode

from .tracer import sanitize, to_dict, verbose_trace

if TYPE_CHECKING:
    from opentelemetry.trace import TracerProvider

# Default OTel tracer name
DEFAULT_TRACER_NAME = "prompty"


def _set_span_attribute(span: Span, key: str, value: Any) -> None:
    """Safely set a span attribute, serializing complex types to JSON strings."""
    try:
        serialized = to_dict(value)
        if isinstance(serialized, (dict, list)):
            span.set_attribute(key, json.dumps(serialized))
        elif serialized is not None:
            span.set_attribute(key, str(serialized))
    except Exception:
        pass


def otel_tracer(
    tracer_name: str = DEFAULT_TRACER_NAME,
    provider: TracerProvider | None = None,
) -> Callable[[str], contextlib._GeneratorContextManager[Callable[[str, Any], None]]]:
    """Create an OTel trace backend compatible with ``Tracer.add()``.

    Each call to the returned factory creates a new OTel span. The yielded
    ``add(key, value)`` callback expands dicts/lists into dotted span
    attributes via :func:`~prompty.tracing.tracer.verbose_trace`.

    Special handling:

    - ``result`` key containing an ``exception`` dict sets ``StatusCode.ERROR``
      and records the exception on the span.
    - All other values are sanitized and expanded into dotted attributes.

    Args:
        tracer_name: Name for the OTel tracer (default: ``"prompty"``).
        provider: Optional ``TracerProvider`` instance. If ``None``, uses
            the globally registered provider.

    Returns:
        A context-manager factory suitable for ``Tracer.add()``.

    Usage::

        from prompty import Tracer
        from prompty.tracing.otel import otel_tracer

        Tracer.add("otel", otel_tracer())
        Tracer.add("otel", otel_tracer(tracer_name="my.service"))
    """
    if provider is not None:
        tracer = provider.get_tracer(tracer_name)
    else:
        tracer = otel_trace.get_tracer(tracer_name)

    @contextlib.contextmanager
    def _tracer(name: str) -> Iterator[Callable[[str, Any], None]]:
        with tracer.start_as_current_span(name) as span:

            def add(key: str, value: Any) -> None:
                # Check for exception in result
                if key == "result" and isinstance(value, dict) and "exception" in value:
                    exc_info = value["exception"]
                    span.set_status(
                        Status(StatusCode.ERROR, str(exc_info.get("message", "")))
                    )
                    span.set_attribute("exception.type", str(exc_info.get("type", "")))
                    span.set_attribute(
                        "exception.message", str(exc_info.get("message", ""))
                    )
                    tb = exc_info.get("traceback")
                    if tb:
                        if isinstance(tb, list):
                            span.set_attribute("exception.stacktrace", "".join(tb))
                        else:
                            span.set_attribute("exception.stacktrace", str(tb))
                    return

                # Use verbose expansion for structured data
                sanitized = sanitize(key, value)
                if isinstance(sanitized, (dict, list)):
                    verbose_trace(
                        lambda k, v: _set_span_attribute(span, k, v), key, sanitized
                    )
                else:
                    _set_span_attribute(span, key, sanitized)

            try:
                yield add
                span.set_status(Status(StatusCode.OK))
            except Exception as e:
                span.set_status(Status(StatusCode.ERROR, str(e)))
                span.record_exception(e)
                if e.__traceback__:
                    span.set_attribute(
                        "exception.stacktrace",
                        "".join(traceback.format_tb(e.__traceback__)),
                    )
                raise

    return _tracer

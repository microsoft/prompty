"""
Pluggable tracing framework for Prompty.

Provides a registry-based tracing system where multiple backends
(JSON file, console, OpenTelemetry, etc.) can be active simultaneously.
Each backend receives the same (key, value) stream via ExitStack.

Usage:
    from prompty import Tracer, trace, PromptyTracer, console_tracer

    # Register backends (any combination)
    Tracer.add("prompty", PromptyTracer().tracer)
    Tracer.add("console", console_tracer)

    @trace
    def my_function(arg1, arg2):
        ...

    @trace(ignore_params=["connection"])
    async def my_async_function(data, connection):
        ...

    with trace_span("operation", attributes={"key": "value"}) as add:
        add("step", "processing")
        ...
"""

import contextlib
import inspect
import json
import os
import traceback
from collections.abc import Callable, Iterator
from dataclasses import asdict, is_dataclass
from datetime import datetime
from functools import partial, wraps
from numbers import Number
from pathlib import Path
from typing import Any

from .._version import VERSION

# Sensitive key patterns for sanitization
_SENSITIVE_PATTERNS = frozenset(
    [
        "key",
        "secret",
        "password",
        "credential",
        "token",
        "auth",
        "bearer",
        "session",
        "cookie",
        "connection",
        "passphrase",
        "cert",
        "private",
    ]
)


def sanitize(key: str, value: Any) -> Any:
    """Redact values whose keys match sensitive patterns.

    Recursively walks dicts and lists, replacing string values
    with ``"**********"`` when the key contains a sensitive pattern.

    Args:
        key: The key name to check for sensitivity.
        value: The value to potentially redact.

    Returns:
        The original value, or a redacted placeholder string.
    """
    if isinstance(value, str) and any(s in key.lower() for s in _SENSITIVE_PATTERNS):
        return 10 * "*"
    elif isinstance(value, dict):
        return {k: sanitize(k, v) for k, v in value.items()}
    elif isinstance(value, list):
        return [sanitize(key, item) for item in value]
    else:
        return value


def to_dict(obj: Any) -> Any:
    """Recursively convert an object to a JSON-serializable form.

    Handles primitives, datetime, dataclasses, Path, dicts, lists,
    and falls back to ``str()`` for unknown types.

    Args:
        obj: Any Python object.

    Returns:
        A JSON-serializable representation.
    """
    if isinstance(obj, str) or isinstance(obj, Number) or isinstance(obj, bool):
        return obj
    elif obj is None:
        return None
    elif isinstance(obj, datetime):
        return obj.isoformat()
    elif is_dataclass(obj) and not isinstance(obj, type):
        return asdict(obj)
    elif isinstance(obj, list):
        return [to_dict(item) for item in obj]
    elif isinstance(obj, dict):
        return {k: v if isinstance(v, str) else to_dict(v) for k, v in obj.items()}
    elif isinstance(obj, Path):
        return str(obj)
    else:
        return str(obj)


def verbose_trace(
    callback: Callable[[str, Any], None],
    prefix: str,
    obj: Any,
    depth: int = 0,
    max_depth: int = 3,
) -> None:
    """Recursively expand dicts/lists into dotted-key calls.

    Useful for backends (like OTel) that prefer flat span attributes
    over nested structures.

    Example::

        {"user": {"name": "Jane", "age": 30}}

    becomes calls to::

        callback("prefix.user.name", "Jane")
        callback("prefix.user.age", 30)

    Args:
        callback: Function called with ``(dotted_key, leaf_value)``.
        prefix: Current key prefix (e.g. ``"inputs"``).
        obj: The object to expand.
        depth: Current recursion depth.
        max_depth: Maximum recursion depth before falling back to ``str()``.
    """
    if depth >= max_depth:
        callback(prefix, obj)
        return

    if isinstance(obj, dict):
        for key, value in obj.items():
            new_prefix = f"{prefix}.{key}"
            if isinstance(value, (dict, list)):
                verbose_trace(callback, new_prefix, value, depth + 1, max_depth)
            else:
                callback(new_prefix, value)
    elif isinstance(obj, list):
        for idx, item in enumerate(obj):
            new_prefix = f"{prefix}[{idx}]"
            if isinstance(item, (dict, list)):
                verbose_trace(callback, new_prefix, item, depth + 1, max_depth)
            else:
                callback(new_prefix, item)
    else:
        callback(prefix, obj)


class Tracer:
    """Registry for trace backends with simultaneous multi-backend support.

    Backends are context-manager factories with the signature::

        Callable[[str], ContextManager[Callable[[str, Any], None]]]

    The factory receives a span name and yields an ``add(key, value)``
    callback. Multiple backends are entered simultaneously via
    ``contextlib.ExitStack``.

    Example::

        Tracer.add("console", console_tracer)
        Tracer.add("json", PromptyTracer().tracer)

        with Tracer.start("my_operation") as trace:
            trace("inputs", {"x": 1})
            trace("result", 42)
    """

    _tracers: dict[
        str,
        Callable[
            [str], contextlib._GeneratorContextManager[Callable[[str, Any], None]]
        ],
    ] = {}

    SIGNATURE = "signature"
    INPUTS = "inputs"
    RESULT = "result"

    @classmethod
    def add(
        cls,
        name: str,
        tracer: Callable[
            [str], contextlib._GeneratorContextManager[Callable[[str, Any], None]]
        ],
    ) -> None:
        """Register a trace backend.

        Args:
            name: Unique name for this backend (e.g. ``"console"``, ``"otel"``).
            tracer: A context-manager factory that accepts a span name and
                yields an ``add(key, value)`` callback.
        """
        cls._tracers[name] = tracer

    @classmethod
    def remove(cls, name: str) -> None:
        """Remove a trace backend by name.

        Args:
            name: The backend name to remove.

        Raises:
            KeyError: If no backend with that name is registered.
        """
        del cls._tracers[name]

    @classmethod
    def clear(cls) -> None:
        """Remove all registered trace backends."""
        cls._tracers = {}

    @classmethod
    @contextlib.contextmanager
    def start(
        cls, name: str, attributes: dict[str, Any] | None = None
    ) -> Iterator[Callable[[str, Any], list[None]]]:
        """Enter all registered backends simultaneously.

        Args:
            name: The span/operation name.
            attributes: Optional initial attributes to emit to all backends.

        Yields:
            A callback ``trace(key, value)`` that fans out to all backends,
            sanitizing values before emission.
        """
        with contextlib.ExitStack() as stack:
            traces: list[Callable[[str, Any], None]] = [
                stack.enter_context(tracer(name)) for tracer in cls._tracers.values()
            ]

            if attributes:
                for t in traces:
                    for key, value in attributes.items():
                        t(key, sanitize(key, to_dict(value)))

            yield lambda key, value: [
                t(key, sanitize(key, to_dict(value))) for t in traces
            ]


# ---------------------------------------------------------------------------
# Trace decorator internals
# ---------------------------------------------------------------------------


def _name(func: Callable, args: tuple) -> tuple[str, str]:
    """Derive a human-readable name and full signature from a callable."""
    if hasattr(func, "__qualname__"):
        signature = f"{func.__module__}.{func.__qualname__}"
    else:
        signature = f"{func.__module__}.{func.__name__}"

    name = func.__name__
    return name, signature


def _inputs(
    func: Callable,
    args: tuple,
    kwargs: dict,
    ignore_params: list[str] | None = None,
) -> dict:
    """Bind and serialize function inputs, excluding ``self`` and ignored params."""
    ba = inspect.signature(func).bind(*args, **kwargs)
    ba.apply_defaults()

    ignore_set = set(ignore_params) if ignore_params else set()
    return {
        k: to_dict(v)
        for k, v in ba.arguments.items()
        if k != "self" and k not in ignore_set
    }


def _results(result: Any) -> Any:
    """Serialize a function result."""
    return to_dict(result) if result is not None else "None"


def _trace_sync(
    func: Callable,
    ignore_params: list[str] | None = None,
    **okwargs: Any,
) -> Callable:
    """Synchronous tracing wrapper."""

    @wraps(func)
    def wrapper(*args, **kwargs):
        name, signature = _name(func, args)
        altname: str | None = None

        if "name" in okwargs:
            altname = name
            name = okwargs["name"]
            del okwargs["name"]

        with Tracer.start(name) as t:
            if altname is not None:
                t("function", altname)

            t("signature", signature)

            for k, v in okwargs.items():
                t(k, to_dict(v))

            inputs = _inputs(func, args, kwargs, ignore_params)
            t("inputs", inputs)

            try:
                result = func(*args, **kwargs)
                t("result", _results(result))
            except Exception as e:
                t(
                    "result",
                    {
                        "exception": {
                            "type": type(e).__name__,
                            "traceback": (
                                traceback.format_tb(tb=e.__traceback__)
                                if e.__traceback__
                                else None
                            ),
                            "message": str(e),
                            "args": to_dict(e.args),
                        }
                    },
                )
                raise

            return result

    return wrapper


def _trace_async(
    func: Callable,
    ignore_params: list[str] | None = None,
    **okwargs: Any,
) -> Callable:
    """Asynchronous tracing wrapper."""

    @wraps(func)
    async def wrapper(*args, **kwargs):
        name, signature = _name(func, args)
        altname: str | None = None

        if "name" in okwargs:
            altname = name
            name = okwargs["name"]
            del okwargs["name"]

        with Tracer.start(name) as t:
            if altname is not None:
                t("function", altname)

            t("signature", signature)

            for k, v in okwargs.items():
                t(k, to_dict(v))

            inputs = _inputs(func, args, kwargs, ignore_params)
            t("inputs", inputs)

            try:
                result = await func(*args, **kwargs)
                t("result", _results(result))
            except Exception as e:
                t(
                    "result",
                    {
                        "exception": {
                            "type": type(e).__name__,
                            "traceback": (
                                traceback.format_tb(tb=e.__traceback__)
                                if e.__traceback__
                                else None
                            ),
                            "message": str(e),
                            "args": to_dict(e.args),
                        }
                    },
                )
                raise

            return result

    return wrapper


def trace(
    func: Callable | None = None,
    ignore_params: list[str] | None = None,
    **kwargs: Any,
) -> Callable:
    """Decorator to trace function execution across all registered backends.

    Works on both sync and async functions. Can be used bare or with parameters.

    Usage::

        @trace
        def my_function(x, y):
            ...

        @trace(name="custom_span")
        async def my_async_function(data):
            ...

        @trace(ignore_params=["connection", "session"])
        def function_with_secrets(data, connection):
            ...

        @trace(custom_attr="value")
        def annotated_function():
            ...

    Args:
        func: The function to trace (None when used with parameters).
        ignore_params: Parameter names to exclude from input serialization.
        **kwargs: Additional attributes to emit to all backends.
    """
    if func is None:
        return partial(trace, ignore_params=ignore_params, **kwargs)

    wrapped_method = _trace_async if inspect.iscoroutinefunction(func) else _trace_sync
    return wrapped_method(func, ignore_params=ignore_params, **kwargs)


@contextlib.contextmanager
def trace_span(
    name: str,
    attributes: dict[str, Any] | None = None,
) -> Iterator[Callable[[str, Any], list[None]]]:
    """Context manager for ad-hoc tracing without a decorator.

    Usage::

        with trace_span("process_batch", attributes={"size": 100}) as t:
            t("step", "validating")
            # ... do work ...
            t("step", "complete")

    Args:
        name: The span/operation name.
        attributes: Optional initial attributes.

    Yields:
        A callback ``trace(key, value)`` that fans out to all backends.
    """
    with Tracer.start(name, attributes) as t:
        yield t


# ---------------------------------------------------------------------------
# Built-in backends
# ---------------------------------------------------------------------------


class PromptyTracer:
    """JSON file trace backend.

    Writes hierarchical ``.tracy`` files to a configurable output directory,
    capturing timing, usage metrics, and nested call frames.

    Args:
        output_dir: Directory for ``.tracy`` files. Defaults to ``.runs/``
            in the current working directory.

    Usage::

        pt = PromptyTracer(output_dir="./traces")
        Tracer.add("prompty", pt.tracer)
    """

    def __init__(self, output_dir: str | None = None) -> None:
        if output_dir:
            self.output = Path(output_dir).resolve().absolute()
        else:
            self.output = Path(Path(os.getcwd()) / ".runs").resolve().absolute()

        if not self.output.exists():
            self.output.mkdir(parents=True, exist_ok=True)

        self.stack: list[dict[str, Any]] = []

    @contextlib.contextmanager
    def tracer(self, name: str) -> Iterator[Callable[[str, Any], None]]:
        """Context manager that captures trace data into a nested frame stack.

        Args:
            name: The span/operation name.

        Yields:
            An ``add(key, value)`` callback for recording trace attributes.
        """
        try:
            self.stack.append({"name": name})
            frame = self.stack[-1]
            frame["__time"] = {
                "start": datetime.now(),
            }

            def add(key: str, value: Any) -> None:
                if key not in frame:
                    frame[key] = value
                else:
                    if isinstance(frame[key], list):
                        frame[key].append(value)
                    else:
                        frame[key] = [frame[key], value]

            yield add
        finally:
            frame = self.stack.pop()
            start: datetime = frame["__time"]["start"]
            end: datetime = datetime.now()

            frame["__time"] = {
                "start": start.strftime("%Y-%m-%dT%H:%M:%S.%f"),
                "end": end.strftime("%Y-%m-%dT%H:%M:%S.%f"),
                "duration": int((end - start).total_seconds() * 1000),
            }

            # Hoist usage from result to frame level
            if "result" in frame and isinstance(frame["result"], dict):
                if "usage" in frame["result"]:
                    frame["__usage"] = self._hoist_item(
                        frame["result"]["usage"],
                        frame.get("__usage", {}),
                    )

            # Streamed results may have usage as well
            if "result" in frame and isinstance(frame["result"], list):
                for result in frame["result"]:
                    if (
                        isinstance(result, dict)
                        and "usage" in result
                        and isinstance(result["usage"], dict)
                    ):
                        frame["__usage"] = self._hoist_item(
                            result["usage"],
                            frame.get("__usage", {}),
                        )

            # Aggregate usage from child frames
            if "__frames" in frame:
                for child in frame["__frames"]:
                    if "__usage" in child:
                        frame["__usage"] = self._hoist_item(
                            child["__usage"],
                            frame.get("__usage", {}),
                        )

            # Root frame — write to disk
            if len(self.stack) == 0:
                self._write_trace(frame)
            # Nested — append to parent
            else:
                if "__frames" not in self.stack[-1]:
                    self.stack[-1]["__frames"] = []
                self.stack[-1]["__frames"].append(frame)

    def _hoist_item(self, src: dict[str, Any], cur: dict[str, Any]) -> dict[str, Any]:
        """Merge numeric usage metrics from *src* into *cur*."""
        for key, value in src.items():
            if value is None or isinstance(value, list) or isinstance(value, dict):
                continue
            try:
                if key not in cur:
                    cur[key] = value
                else:
                    cur[key] += value
            except Exception:
                continue
        return cur

    def _write_trace(self, frame: dict[str, Any]) -> None:
        """Write a completed trace frame to a ``.tracy`` file."""
        trace_file = (
            self.output
            / f"{frame['name']}.{datetime.now().strftime('%Y%m%d.%H%M%S')}.tracy"
        )

        enriched_frame = {
            "runtime": "python",
            "version": VERSION,
            "trace": frame,
        }

        with open(trace_file, "w", encoding="utf-8") as f:
            json.dump(enriched_frame, f, indent=4)


@contextlib.contextmanager
def console_tracer(name: str) -> Iterator[Callable[[str, Any], None]]:
    """Simple print-based trace backend.

    Prints the span name on entry/exit, and pretty-prints each
    ``(key, value)`` pair as it is emitted.

    Usage::

        Tracer.add("console", console_tracer)

    Args:
        name: The span/operation name.

    Yields:
        An ``add(key, value)`` callback that prints to stdout.
    """
    try:
        print(f"Starting {name}")
        yield lambda key, value: print(
            f"{key}:\n{json.dumps(to_dict(value), indent=4)}"
        )
    finally:
        print(f"Ending {name}")

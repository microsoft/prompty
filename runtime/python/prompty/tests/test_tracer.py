"""Tests for the pluggable tracing framework."""

import asyncio
import contextlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from prompty.tracer import (
    PromptyTracer,
    Tracer,
    _inputs,
    _name,
    _results,
    console_tracer,
    sanitize,
    to_dict,
    trace,
    trace_span,
    verbose_trace,
)


# ---------------------------------------------------------------------------
# sanitize
# ---------------------------------------------------------------------------
class TestSanitize:
    def test_redacts_key_pattern(self):
        assert sanitize("api_key", "sk-12345") == "**********"

    def test_redacts_secret(self):
        assert sanitize("my_secret", "hunter2") == "**********"

    def test_redacts_password(self):
        assert sanitize("password", "p@ss") == "**********"

    def test_redacts_credential(self):
        assert sanitize("credential", "cred") == "**********"

    def test_redacts_token(self):
        assert sanitize("auth_token", "tok_123") == "**********"

    def test_redacts_auth(self):
        assert sanitize("auth_header", "Bearer xyz") == "**********"

    def test_redacts_bearer(self):
        assert sanitize("bearer_value", "xyz") == "**********"

    def test_redacts_session(self):
        assert sanitize("session_id", "abc") == "**********"

    def test_redacts_cookie(self):
        assert sanitize("cookie_val", "c=1") == "**********"

    def test_redacts_connection(self):
        assert sanitize("connection_string", "Server=...") == "**********"

    def test_redacts_passphrase(self):
        assert sanitize("passphrase", "shhh") == "**********"

    def test_redacts_cert(self):
        assert sanitize("client_cert", "MIIB...") == "**********"

    def test_redacts_private(self):
        assert sanitize("private_key", "-----BEGIN") == "**********"

    def test_preserves_non_sensitive(self):
        assert sanitize("username", "admin") == "admin"

    def test_preserves_non_string(self):
        assert sanitize("api_key", 12345) == 12345

    def test_recurses_dicts(self):
        result = sanitize("config", {"api_key": "sk-123", "model": "gpt-4"})
        assert result["api_key"] == "**********"
        assert result["model"] == "gpt-4"

    def test_recurses_lists(self):
        result = sanitize("api_key", ["sk-123", "sk-456"])
        assert result == ["**********", "**********"]

    def test_case_insensitive(self):
        assert sanitize("API_KEY", "sk-123") == "**********"
        assert sanitize("ApiKey", "sk-123") == "**********"


# ---------------------------------------------------------------------------
# to_dict
# ---------------------------------------------------------------------------
class TestToDict:
    def test_string(self):
        assert to_dict("hello") == "hello"

    def test_number(self):
        assert to_dict(42) == 42
        assert to_dict(3.14) == 3.14

    def test_bool(self):
        assert to_dict(True) is True

    def test_none(self):
        assert to_dict(None) is None

    def test_datetime(self):
        dt = datetime(2024, 1, 15, 10, 30, 0)
        assert to_dict(dt) == "2024-01-15T10:30:00"

    def test_path(self):
        p = Path("/tmp/test.txt")
        result = to_dict(p)
        assert isinstance(result, str)
        assert "test.txt" in result

    def test_list(self):
        assert to_dict([1, "two", 3]) == [1, "two", 3]

    def test_dict(self):
        assert to_dict({"a": 1, "b": "two"}) == {"a": 1, "b": "two"}

    def test_nested_dict(self):
        result = to_dict({"a": {"b": Path("/tmp")}})
        assert isinstance(result["a"]["b"], str)

    def test_unknown_type(self):
        """Unknown types fall back to str()."""

        class Custom:
            def __str__(self):
                return "custom_repr"

        assert to_dict(Custom()) == "custom_repr"


# ---------------------------------------------------------------------------
# verbose_trace
# ---------------------------------------------------------------------------
class TestVerboseTrace:
    def test_flat_dict(self):
        calls: list[tuple[str, Any]] = []
        verbose_trace(lambda k, v: calls.append((k, v)), "p", {"a": 1, "b": "x"})
        assert ("p.a", 1) in calls
        assert ("p.b", "x") in calls

    def test_nested_dict(self):
        calls: list[tuple[str, Any]] = []
        verbose_trace(lambda k, v: calls.append((k, v)), "p", {"user": {"name": "Jane"}})
        assert ("p.user.name", "Jane") in calls

    def test_list(self):
        calls: list[tuple[str, Any]] = []
        verbose_trace(lambda k, v: calls.append((k, v)), "items", [10, 20])
        assert ("items[0]", 10) in calls
        assert ("items[1]", 20) in calls

    def test_list_of_dicts(self):
        calls: list[tuple[str, Any]] = []
        verbose_trace(lambda k, v: calls.append((k, v)), "msgs", [{"role": "user"}])
        assert ("msgs[0].role", "user") in calls

    def test_max_depth(self):
        """At max_depth, the object is emitted as-is."""
        calls: list[tuple[str, Any]] = []
        deep = {"a": {"b": {"c": {"d": 1}}}}
        verbose_trace(lambda k, v: calls.append((k, v)), "x", deep, max_depth=2)
        # depth 0: dict key "a" → depth 1: dict key "b" → depth 2: hits max, emits as-is
        assert any(k == "x.a.b" for k, v in calls)

    def test_scalar(self):
        calls: list[tuple[str, Any]] = []
        verbose_trace(lambda k, v: calls.append((k, v)), "val", 42)
        assert calls == [("val", 42)]


# ---------------------------------------------------------------------------
# Tracer registry
# ---------------------------------------------------------------------------
class TestTracerRegistry:
    def setup_method(self):
        Tracer.clear()

    def teardown_method(self):
        Tracer.clear()

    def test_add_and_start(self):
        """Registered backend receives trace calls."""
        received: list[tuple[str, Any]] = []

        @contextlib.contextmanager
        def mock_tracer(name):
            received.append(("__start__", name))
            yield lambda k, v: received.append((k, v))
            received.append(("__end__", name))

        Tracer.add("test", mock_tracer)
        with Tracer.start("op") as t:
            t("key", "value")

        assert ("__start__", "op") in received
        assert ("__end__", "op") in received
        # value is sanitized + to_dict'd
        assert any(k == "key" for k, _ in received)

    def test_multiple_backends(self):
        """Multiple backends receive the same calls."""
        log_a: list[str] = []
        log_b: list[str] = []

        @contextlib.contextmanager
        def tracer_a(name):
            yield lambda k, v: log_a.append(k)

        @contextlib.contextmanager
        def tracer_b(name):
            yield lambda k, v: log_b.append(k)

        Tracer.add("a", tracer_a)
        Tracer.add("b", tracer_b)

        with Tracer.start("op") as t:
            t("x", 1)
            t("y", 2)

        assert log_a == ["x", "y"]
        assert log_b == ["x", "y"]

    def test_clear(self):
        @contextlib.contextmanager
        def noop(name):
            yield lambda k, v: None

        Tracer.add("test", noop)
        assert len(Tracer._tracers) == 1
        Tracer.clear()
        assert len(Tracer._tracers) == 0

    def test_remove(self):
        @contextlib.contextmanager
        def noop(name):
            yield lambda k, v: None

        Tracer.add("test", noop)
        Tracer.remove("test")
        assert "test" not in Tracer._tracers

    def test_remove_nonexistent_raises(self):
        with pytest.raises(KeyError):
            Tracer.remove("nonexistent")

    def test_start_with_attributes(self):
        received: list[tuple[str, Any]] = []

        @contextlib.contextmanager
        def mock_tracer(name):
            yield lambda k, v: received.append((k, v))

        Tracer.add("test", mock_tracer)
        with Tracer.start("op", attributes={"env": "test"}):
            pass

        assert any(k == "env" and v == "test" for k, v in received)

    def test_no_backends_is_noop(self):
        """With no backends registered, start() still works as a no-op."""
        with Tracer.start("op") as t:
            t("key", "value")  # should not raise


# ---------------------------------------------------------------------------
# @trace decorator
# ---------------------------------------------------------------------------
class TestTraceDecorator:
    def setup_method(self):
        Tracer.clear()
        self.log: list[tuple[str, Any]] = []

        @contextlib.contextmanager
        def capture(name):
            self.log.append(("__start__", name))
            yield lambda k, v: self.log.append((k, v))
            self.log.append(("__end__", name))

        Tracer.add("capture", capture)

    def teardown_method(self):
        Tracer.clear()

    def test_sync_function(self):
        @trace
        def add(a, b):
            return a + b

        result = add(1, 2)
        assert result == 3
        assert ("__start__", "add") in self.log
        assert any(k == "inputs" for k, _ in self.log)
        assert any(k == "result" for k, _ in self.log)

    def test_async_function(self):
        @trace
        async def add(a, b):
            return a + b

        result = asyncio.run(add(1, 2))
        assert result == 3
        assert ("__start__", "add") in self.log
        assert any(k == "inputs" for k, _ in self.log)

    def test_custom_name(self):
        @trace(name="custom_op")
        def my_func():
            return 42

        my_func()
        assert ("__start__", "custom_op") in self.log

    def test_ignore_params(self):
        @trace(ignore_params=["secret"])
        def process(data, secret):
            return data

        process("hello", "hunter2")
        inputs_entry = next(v for k, v in self.log if k == "inputs")
        assert "data" in inputs_entry
        assert "secret" not in inputs_entry

    def test_extra_kwargs(self):
        @trace(custom_attr="value123")
        def my_func():
            return 1

        my_func()
        assert any(k == "custom_attr" for k, _ in self.log)

    def test_exception_traced(self):
        @trace
        def failing():
            raise ValueError("boom")

        with pytest.raises(ValueError, match="boom"):
            failing()

        result_entry = next(v for k, v in self.log if k == "result" and isinstance(v, dict))
        assert "exception" in result_entry
        assert result_entry["exception"]["type"] == "ValueError"
        assert result_entry["exception"]["message"] == "boom"

    def test_async_exception_traced(self):
        @trace
        async def failing():
            raise RuntimeError("async boom")

        with pytest.raises(RuntimeError, match="async boom"):
            asyncio.run(failing())

        result_entry = next(v for k, v in self.log if k == "result" and isinstance(v, dict))
        assert "exception" in result_entry
        assert result_entry["exception"]["type"] == "RuntimeError"

    def test_signature_recorded(self):
        @trace
        def my_func():
            return 1

        my_func()
        sig = next(v for k, v in self.log if k == "signature")
        assert "my_func" in sig


# ---------------------------------------------------------------------------
# trace_span
# ---------------------------------------------------------------------------
class TestTraceSpan:
    def setup_method(self):
        Tracer.clear()
        self.log: list[tuple[str, Any]] = []

        @contextlib.contextmanager
        def capture(name):
            self.log.append(("__start__", name))
            yield lambda k, v: self.log.append((k, v))
            self.log.append(("__end__", name))

        Tracer.add("capture", capture)

    def teardown_method(self):
        Tracer.clear()

    def test_basic_span(self):
        with trace_span("my_op") as t:
            t("step", "processing")

        assert ("__start__", "my_op") in self.log
        assert ("__end__", "my_op") in self.log
        assert any(k == "step" for k, _ in self.log)

    def test_span_with_attributes(self):
        with trace_span("my_op", attributes={"batch_size": 100}) as t:
            t("status", "done")

        assert any(k == "batch_size" for k, _ in self.log)
        assert any(k == "status" for k, _ in self.log)


# ---------------------------------------------------------------------------
# PromptyTracer
# ---------------------------------------------------------------------------
class TestPromptyTracer:
    def test_writes_tracy_file(self, tmp_path):
        pt = PromptyTracer(output_dir=str(tmp_path))
        Tracer.clear()
        Tracer.add("prompty", pt.tracer)

        @trace
        def my_func(x):
            return x * 2

        my_func(5)

        files = list(tmp_path.glob("*.tracy"))
        assert len(files) == 1

        with open(files[0]) as f:
            data = json.load(f)

        assert data["runtime"] == "python"
        assert "version" in data
        assert "trace" in data
        assert data["trace"]["name"] == "my_func"
        assert "__time" in data["trace"]
        assert "start" in data["trace"]["__time"]
        assert "end" in data["trace"]["__time"]
        assert "duration" in data["trace"]["__time"]

        Tracer.clear()

    def test_nested_frames(self, tmp_path):
        pt = PromptyTracer(output_dir=str(tmp_path))
        Tracer.clear()
        Tracer.add("prompty", pt.tracer)

        @trace
        def inner():
            return 1

        @trace
        def outer():
            return inner()

        outer()

        files = list(tmp_path.glob("*.tracy"))
        assert len(files) == 1

        with open(files[0]) as f:
            data = json.load(f)

        assert data["trace"]["name"] == "outer"
        assert "__frames" in data["trace"]
        assert data["trace"]["__frames"][0]["name"] == "inner"

        Tracer.clear()

    def test_usage_hoisting(self, tmp_path):
        pt = PromptyTracer(output_dir=str(tmp_path))
        Tracer.clear()
        Tracer.add("prompty", pt.tracer)

        with Tracer.start("llm_call") as t:
            t(
                "result",
                {
                    "content": "hi",
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                },
            )

        files = list(tmp_path.glob("*.tracy"))
        assert len(files) == 1

        with open(files[0]) as f:
            data = json.load(f)

        assert "__usage" in data["trace"]
        assert data["trace"]["__usage"]["prompt_tokens"] == 10
        assert data["trace"]["__usage"]["completion_tokens"] == 5

        Tracer.clear()

    def test_default_output_dir(self):
        """Default output dir is .runs/ in CWD."""
        pt = PromptyTracer()
        assert pt.output.name == ".runs"

        Tracer.clear()


# ---------------------------------------------------------------------------
# console_tracer
# ---------------------------------------------------------------------------
class TestConsoleTracer:
    def test_prints_output(self, capsys):
        Tracer.clear()
        Tracer.add("console", console_tracer)

        with Tracer.start("test_op") as t:
            t("greeting", "hello")

        captured = capsys.readouterr()
        assert "Starting test_op" in captured.out
        assert "Ending test_op" in captured.out
        assert "hello" in captured.out

        Tracer.clear()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
class TestHelpers:
    def test_name_regular_function(self):
        def my_func():
            pass

        name, sig = _name(my_func, ())
        assert name == "my_func"
        assert "my_func" in sig

    def test_inputs_basic(self):
        def add(a, b):
            return a + b

        result = _inputs(add, (1, 2), {})
        assert result == {"a": 1, "b": 2}

    def test_inputs_ignore_params(self):
        def process(data, conn):
            pass

        result = _inputs(process, ("hello", "secret"), {}, ignore_params=["conn"])
        assert "data" in result
        assert "conn" not in result

    def test_inputs_excludes_self(self):
        class MyClass:
            def method(self, x):
                pass

        obj = MyClass()
        # Bound methods already exclude 'self' from the signature
        result = _inputs(obj.method, (42,), {})
        assert "self" not in result
        assert result["x"] == 42

    def test_results_none(self):
        assert _results(None) == "None"

    def test_results_value(self):
        assert _results(42) == 42
        assert _results("hello") == "hello"

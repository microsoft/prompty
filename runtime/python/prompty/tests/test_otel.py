"""Tests for the OpenTelemetry trace backend.

These tests are skipped if opentelemetry is not installed.
"""

import pytest

otel_api = pytest.importorskip(
    "opentelemetry", reason="opentelemetry-api not installed"
)

from opentelemetry.sdk.trace import ReadableSpan, TracerProvider  # noqa: E402
from opentelemetry.sdk.trace.export import (  # noqa: E402
    SimpleSpanProcessor,
    SpanExporter,
    SpanExportResult,
)

from prompty.tracing.otel import otel_tracer  # noqa: E402
from prompty.tracing.tracer import Tracer, trace  # noqa: E402


class _InMemoryExporter(SpanExporter):
    """Minimal in-memory exporter for testing (compatible with all OTel SDK versions)."""

    def __init__(self):
        self._spans: list[ReadableSpan] = []

    def export(self, spans):
        self._spans.extend(spans)
        return SpanExportResult.SUCCESS

    def shutdown(self):
        pass

    def get_finished_spans(self) -> list[ReadableSpan]:
        return list(self._spans)


@pytest.fixture()
def otel_exporter():
    """Set up an in-memory OTel exporter and register the otel backend."""
    exporter = _InMemoryExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))

    Tracer.clear()
    Tracer.add("otel", otel_tracer(provider=provider))
    yield exporter
    Tracer.clear()
    provider.shutdown()


class TestOtelTracer:
    def test_creates_span(self, otel_exporter):
        with Tracer.start("test_span") as t:
            t("greeting", "hello")

        spans = otel_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].name == "test_span"

    def test_span_attributes(self, otel_exporter):
        with Tracer.start("attr_span") as t:
            t("model", "gpt-4")

        spans = otel_exporter.get_finished_spans()
        attrs = dict(spans[0].attributes or {})
        assert attrs.get("model") == "gpt-4"

    def test_dotted_expansion(self, otel_exporter):
        with Tracer.start("expand_span") as t:
            t("inputs", {"user": {"name": "Jane"}})

        spans = otel_exporter.get_finished_spans()
        attrs = dict(spans[0].attributes or {})
        assert attrs.get("inputs.user.name") == "Jane"

    def test_error_handling(self, otel_exporter):
        with Tracer.start("error_span") as t:
            t(
                "result",
                {
                    "exception": {
                        "type": "ValueError",
                        "message": "bad input",
                        "traceback": ["line 1\n", "line 2\n"],
                    }
                },
            )

        spans = otel_exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = dict(spans[0].attributes or {})
        assert attrs.get("exception.type") == "ValueError"
        assert attrs.get("exception.message") == "bad input"

    def test_with_trace_decorator(self, otel_exporter):
        @trace
        def add(a, b):
            return a + b

        result = add(2, 3)
        assert result == 5

        spans = otel_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].name == "add"

    def test_sanitizes_sensitive_values(self, otel_exporter):
        with Tracer.start("sensitive_span") as t:
            t("config", {"api_key": "sk-secret", "model": "gpt-4"})

        spans = otel_exporter.get_finished_spans()
        attrs = dict(spans[0].attributes or {})
        assert attrs.get("config.api_key") == "**********"
        assert attrs.get("config.model") == "gpt-4"

    def test_custom_tracer_name(self, otel_exporter):
        """otel_tracer accepts a custom tracer name."""
        # The fixture already registered with default name;
        # this just validates the param is accepted
        Tracer.clear()
        provider = TracerProvider()
        exporter = _InMemoryExporter()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        Tracer.add(
            "otel", otel_tracer(tracer_name="my.custom.tracer", provider=provider)
        )

        with Tracer.start("custom_name_span") as t:
            t("x", 1)

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        provider.shutdown()

    def test_nested_spans(self, otel_exporter):
        @trace
        def inner():
            return 1

        @trace
        def outer():
            return inner()

        outer()
        spans = otel_exporter.get_finished_spans()
        assert len(spans) == 2
        names = {s.name for s in spans}
        assert "inner" in names
        assert "outer" in names

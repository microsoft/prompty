"""Tests for agent loop resilience features (§9.8, §9.9, §9.10)."""

from __future__ import annotations

import json
import warnings
from unittest.mock import MagicMock, patch

import pytest

from prompty.core.tool_dispatch import (
    _extract_first_json_block,
    _resilient_json_parse,
    dispatch_tool,
    dispatch_tool_async,
)

# ---------------------------------------------------------------------------
# §9.8: Resilient JSON parsing
# ---------------------------------------------------------------------------


class TestResilientJsonParse:
    """§9.8: Resilient argument parsing."""

    def test_direct_parse(self):
        result = _resilient_json_parse('{"city": "NY"}')
        assert result == {"city": "NY"}

    def test_direct_parse_array(self):
        result = _resilient_json_parse("[1, 2, 3]")
        assert result == [1, 2, 3]

    def test_markdown_fences(self):
        raw = '```json\n{"city": "NY"}\n```'
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = _resilient_json_parse(raw)
            assert result == {"city": "NY"}
            assert len(w) == 1
            assert "markdown fences" in str(w[0].message)

    def test_markdown_fences_no_lang(self):
        raw = '```\n{"city": "NY"}\n```'
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = _resilient_json_parse(raw)
            assert result == {"city": "NY"}
            assert len(w) == 1

    def test_extract_json_block(self):
        raw = 'Here is the result: {"city": "NY"} enjoy!'
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = _resilient_json_parse(raw)
            assert result == {"city": "NY"}
            assert len(w) == 1
            assert "JSON block" in str(w[0].message)

    def test_trailing_commas(self):
        raw = '{"city": "NY", "temp": 72,}'
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = _resilient_json_parse(raw)
            assert result["city"] == "NY"
            assert result["temp"] == 72
            assert len(w) == 1
            assert "trailing commas" in str(w[0].message)

    def test_all_fail_returns_none(self):
        result = _resilient_json_parse("not json at all")
        assert result is None

    def test_no_silent_empty_object(self):
        """Spec: MUST NOT silently substitute empty object."""
        result = _resilient_json_parse("garbage text")
        assert result is None  # NOT {}

    def test_valid_json_no_warnings(self):
        """Direct parse should not emit warnings."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            result = _resilient_json_parse('{"a": 1}')
            assert result == {"a": 1}
            assert len(w) == 0

    def test_empty_string(self):
        """Empty string is not valid JSON."""
        result = _resilient_json_parse("")
        assert result is None


class TestExtractJsonBlock:
    def test_respects_string_escapes(self):
        raw = r'prefix {"key": "value with {braces}"} suffix'
        block = _extract_first_json_block(raw)
        parsed = json.loads(block)
        assert parsed["key"] == "value with {braces}"

    def test_no_json(self):
        assert _extract_first_json_block("no json here") is None

    def test_nested_objects(self):
        raw = 'text {"a": {"b": 1}} more'
        block = _extract_first_json_block(raw)
        parsed = json.loads(block)
        assert parsed["a"]["b"] == 1

    def test_escaped_quotes_in_string(self):
        raw = r'{"key": "value with \"escaped\" quotes"}'
        block = _extract_first_json_block(raw)
        assert block is not None
        parsed = json.loads(block)
        assert "escaped" in parsed["key"]


class TestDispatchToolResilience:
    """Integration: dispatch_tool with resilient parsing."""

    def test_dispatch_with_markdown_fences(self):
        def my_tool(city: str = "") -> str:
            return f"Weather in {city}"

        result = dispatch_tool(
            "my_tool",
            '```json\n{"city": "NY"}\n```',
            {"my_tool": my_tool},
            MagicMock(),
            {},
        )
        assert "Weather in NY" in result

    def test_dispatch_with_garbage_args(self):
        def my_tool(**kwargs: object) -> str:
            return "ok"

        result = dispatch_tool(
            "my_tool",
            "totally not json",
            {"my_tool": my_tool},
            MagicMock(),
            {},
        )
        assert "Error" in result
        assert "all parse strategies failed" in result


# ---------------------------------------------------------------------------
# §9.9: Tool execution error safety
# ---------------------------------------------------------------------------


class TestToolErrorSafety:
    """§9.9: Tool execution error safety."""

    def test_tool_exception_returns_error_string(self):
        """Tool that raises should return error string, not propagate."""

        def bad_tool(**kwargs: object) -> str:
            raise RuntimeError("tool exploded")

        result = dispatch_tool(
            "bad_tool",
            "{}",
            {"bad_tool": bad_tool},
            MagicMock(),
            {},
        )
        assert "Error" in result
        assert "exploded" in result

    @pytest.mark.asyncio
    async def test_async_tool_exception_returns_error_string(self):
        """Async tool that raises should return error string, not propagate."""

        async def bad_tool(**kwargs: object) -> str:
            raise RuntimeError("async boom")

        result = await dispatch_tool_async(
            "bad_tool",
            "{}",
            {"bad_tool": bad_tool},
            MagicMock(),
            {},
        )
        assert "Error" in result
        assert "async boom" in result

    def test_tool_error_does_not_propagate(self):
        """dispatch_tool should never raise — always returns str."""

        def exploding_tool(**kwargs: object) -> str:
            raise ValueError("kaboom")

        # This should NOT raise
        result = dispatch_tool(
            "exploding_tool",
            "{}",
            {"exploding_tool": exploding_tool},
            MagicMock(),
            {},
        )
        assert isinstance(result, str)
        assert "kaboom" in result


# ---------------------------------------------------------------------------
# §9.10: LLM call retry
# ---------------------------------------------------------------------------


class TestLlmRetry:
    """§9.10: LLM call retry."""

    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline.time.sleep")
    def test_retry_success_on_second_attempt(self, mock_sleep, mock_process, mock_prepare, mock_execute):
        from prompty.core.pipeline import turn
        from prompty.core.types import Message, TextPart

        mock_prepare.return_value = [Message(role="user", parts=[TextPart(value="hi")])]
        mock_process.return_value = "processed result"

        # Fail first, succeed second
        final_response = MagicMock()
        final_response.choices = [MagicMock()]
        final_response.choices[0].finish_reason = "stop"
        final_response.choices[0].message.tool_calls = None
        final_response.choices[0].message.content = "success"

        mock_execute.side_effect = [Exception("transient"), final_response]

        # Need tools to enter agent loop
        turn(
            MagicMock(),
            {},
            tools={"dummy": lambda: "ok"},
            max_llm_retries=3,
        )
        assert mock_execute.call_count == 2
        mock_sleep.assert_called_once()

    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    @patch("prompty.core.pipeline.time.sleep")
    def test_retry_exhausted_raises_execute_error(self, mock_sleep, mock_prepare, mock_execute):
        from prompty.core.pipeline import ExecuteError, turn
        from prompty.core.types import Message, TextPart

        mock_prepare.return_value = [Message(role="user", parts=[TextPart(value="hi")])]
        mock_execute.side_effect = Exception("persistent failure")

        with pytest.raises(ExecuteError) as exc_info:
            turn(
                MagicMock(),
                {},
                tools={"dummy": lambda: "ok"},
                max_llm_retries=2,
            )
        assert exc_info.value.messages is not None
        assert len(exc_info.value.messages) > 0
        assert "persistent failure" in str(exc_info.value)

    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    @patch("prompty.core.pipeline.time.sleep")
    def test_no_retry_on_fast_path(self, mock_sleep, mock_prepare, mock_execute):
        """Fast path (no tools) should NOT use retry."""
        from prompty.core.pipeline import turn
        from prompty.core.types import Message, TextPart

        mock_prepare.return_value = [Message(role="user", parts=[TextPart(value="hi")])]
        mock_execute.side_effect = Exception("should not retry")

        # No tools = fast path, no retry
        with pytest.raises(Exception, match="should not retry"):
            turn(MagicMock(), {}, tools=None)

        assert mock_execute.call_count == 1
        mock_sleep.assert_not_called()

    def test_execute_error_has_messages(self):
        from prompty.core.pipeline import ExecuteError
        from prompty.core.types import Message, TextPart

        msgs = [Message(role="user", parts=[TextPart(value="test")])]
        err = ExecuteError("test error", messages=msgs)
        assert str(err) == "test error"
        assert err.messages == msgs

    def test_execute_error_default_messages(self):
        from prompty.core.pipeline import ExecuteError

        err = ExecuteError("test error")
        assert err.messages == []

    def test_execute_error_importable_from_prompty(self):
        from prompty import ExecuteError

        assert issubclass(ExecuteError, Exception)

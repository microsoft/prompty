"""Tests for §8.8 Structured Result Casting."""

from __future__ import annotations

import dataclasses
import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from prompty.core.structured import StructuredResult, cast


# --- StructuredResult tests ---


class TestStructuredResult:
    def test_is_dict(self):
        sr = StructuredResult({"name": "Jane", "age": 30}, '{"name":"Jane","age":30}')
        assert isinstance(sr, dict)

    def test_dict_access(self):
        sr = StructuredResult({"name": "Jane"}, '{"name":"Jane"}')
        assert sr["name"] == "Jane"

    def test_iteration(self):
        sr = StructuredResult({"a": 1, "b": 2}, '{"a":1,"b":2}')
        assert set(sr.keys()) == {"a", "b"}

    def test_raw_json_preserved(self):
        raw = '{"temperature": 72, "unit": "F"}'
        sr = StructuredResult(json.loads(raw), raw)
        assert sr._raw_json == raw

    def test_repr(self):
        sr = StructuredResult({"x": 1}, '{"x":1}')
        assert "StructuredResult" in repr(sr)

    def test_len(self):
        sr = StructuredResult({"a": 1, "b": 2, "c": 3}, "{}")
        assert len(sr) == 3

    def test_equality_with_dict(self):
        sr = StructuredResult({"a": 1}, '{"a":1}')
        assert sr == {"a": 1}

    def test_get_method(self):
        sr = StructuredResult({"a": 1}, '{"a":1}')
        assert sr.get("a") == 1
        assert sr.get("missing", 42) == 42

    def test_in_operator(self):
        sr = StructuredResult({"a": 1}, '{"a":1}')
        assert "a" in sr
        assert "b" not in sr

    def test_values_and_items(self):
        sr = StructuredResult({"a": 1, "b": 2}, '{"a":1,"b":2}')
        assert sorted(sr.values()) == [1, 2]
        assert sorted(sr.items()) == [("a", 1), ("b", 2)]


# --- cast tests ---


@dataclasses.dataclass
class WeatherResponse:
    temperature: float
    unit: str
    city: str


@dataclasses.dataclass
class SimpleResponse:
    message: str


class TestCast:
    def test_cast_structured_result_to_dataclass(self):
        raw = '{"temperature": 72.5, "unit": "F", "city": "Seattle"}'
        sr = StructuredResult(json.loads(raw), raw)
        result = cast(sr, WeatherResponse)
        assert isinstance(result, WeatherResponse)
        assert result.temperature == 72.5
        assert result.unit == "F"
        assert result.city == "Seattle"

    def test_cast_dict_to_dataclass(self):
        """Fallback when not a StructuredResult — still works via json round-trip."""
        data = {"message": "hello"}
        result = cast(data, SimpleResponse)
        assert isinstance(result, SimpleResponse)
        assert result.message == "hello"

    def test_cast_string_to_dataclass(self):
        raw = '{"message": "from string"}'
        result = cast(raw, SimpleResponse)
        assert isinstance(result, SimpleResponse)
        assert result.message == "from string"

    def test_cast_to_dict(self):
        raw = '{"a": 1, "b": 2}'
        sr = StructuredResult(json.loads(raw), raw)
        result = cast(sr, dict)
        assert result == {"a": 1, "b": 2}

    def test_cast_to_list(self):
        raw = "[1, 2, 3]"
        result = cast(raw, list)
        assert result == [1, 2, 3]

    def test_cast_to_int(self):
        raw = "42"
        result = cast(raw, int)
        assert result == 42

    def test_cast_to_str(self):
        raw = '"hello"'
        result = cast(raw, str)
        assert result == "hello"

    def test_cast_to_float(self):
        raw = "3.14"
        result = cast(raw, float)
        assert result == pytest.approx(3.14)

    def test_cast_to_bool(self):
        raw = "true"
        result = cast(raw, bool)
        assert result is True

    def test_cast_type_error(self):
        raw = '{"a": 1}'
        sr = StructuredResult(json.loads(raw), raw)
        with pytest.raises(TypeError, match="Cannot cast"):
            cast(sr, int)

    def test_cast_preserves_nested_objects(self):
        @dataclasses.dataclass
        class Address:
            city: str
            state: str

        raw = '{"city": "Seattle", "state": "WA"}'
        sr = StructuredResult(json.loads(raw), raw)
        result = cast(sr, Address)
        assert result.city == "Seattle"
        assert result.state == "WA"

    def test_cast_dataclass_with_non_dict_json_raises(self):
        """A JSON array cannot be cast to a dataclass."""
        raw = "[1, 2, 3]"
        with pytest.raises(TypeError, match="Cannot cast"):
            cast(raw, SimpleResponse)

    def test_cast_pydantic_model_if_available(self):
        """Test Pydantic integration if pydantic is installed."""
        try:
            from pydantic import BaseModel

            class PydanticWeather(BaseModel):
                temperature: float
                city: str

            raw = '{"temperature": 72.5, "city": "Portland"}'
            sr = StructuredResult(json.loads(raw), raw)
            result = cast(sr, PydanticWeather)
            assert isinstance(result, PydanticWeather)
            assert result.temperature == 72.5
            assert result.city == "Portland"
        except ImportError:
            pytest.skip("pydantic not installed")

    def test_cast_pydantic_from_string_if_available(self):
        """Pydantic model_validate_json works from raw string too."""
        try:
            from pydantic import BaseModel

            class PydanticItem(BaseModel):
                name: str
                count: int

            raw = '{"name": "widget", "count": 5}'
            result = cast(raw, PydanticItem)
            assert isinstance(result, PydanticItem)
            assert result.name == "widget"
            assert result.count == 5
        except ImportError:
            pytest.skip("pydantic not installed")


# --- Integration: processor returns StructuredResult ---


class TestProcessorStructuredResult:
    def test_openai_processor_returns_structured_result_on_chat(self):
        """OpenAI processor returns StructuredResult when outputs is defined."""
        from prompty.providers.openai.processor import _process_response

        agent = MagicMock()
        agent.outputs = [MagicMock()]
        agent.model = MagicMock()
        agent.model.apiType = "chat"

        # Create a mock ChatCompletion
        mock_choice = MagicMock()
        mock_choice.message.content = '{"result": "test"}'
        mock_choice.message.refusal = None
        mock_choice.message.tool_calls = None
        mock_choice.finish_reason = "stop"

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]

        # Make isinstance check work for ChatCompletion
        try:
            from openai.types.chat.chat_completion import ChatCompletion

            mock_response.__class__ = ChatCompletion  # type: ignore[assignment]
        except ImportError:
            pytest.skip("openai not installed")

        result = _process_response(mock_response, agent)
        assert isinstance(result, StructuredResult)
        assert result["result"] == "test"
        assert result._raw_json == '{"result": "test"}'

    def test_openai_processor_returns_string_when_no_outputs(self):
        """When outputs is not defined, processor returns plain string."""
        from prompty.providers.openai.processor import _process_response

        agent = MagicMock()
        agent.outputs = None

        mock_choice = MagicMock()
        mock_choice.message.content = "plain text response"
        mock_choice.message.refusal = None
        mock_choice.message.tool_calls = None

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]

        try:
            from openai.types.chat.chat_completion import ChatCompletion

            mock_response.__class__ = ChatCompletion  # type: ignore[assignment]
        except ImportError:
            pytest.skip("openai not installed")

        result = _process_response(mock_response, agent)
        assert isinstance(result, str)
        assert not isinstance(result, StructuredResult)
        assert result == "plain text response"

    def test_openai_processor_falls_back_to_string_on_invalid_json(self):
        """When outputs is defined but content isn't valid JSON, returns string."""
        from prompty.providers.openai.processor import _process_response

        agent = MagicMock()
        agent.outputs = [MagicMock()]

        mock_choice = MagicMock()
        mock_choice.message.content = "not valid json"
        mock_choice.message.refusal = None
        mock_choice.message.tool_calls = None

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]

        try:
            from openai.types.chat.chat_completion import ChatCompletion

            mock_response.__class__ = ChatCompletion  # type: ignore[assignment]
        except ImportError:
            pytest.skip("openai not installed")

        result = _process_response(mock_response, agent)
        assert isinstance(result, str)
        assert result == "not valid json"

    def test_anthropic_processor_returns_structured_result(self):
        """Anthropic processor returns StructuredResult when outputs is defined."""
        from prompty.providers.anthropic.processor import _process_response

        agent = MagicMock()
        agent.outputs = [MagicMock()]

        response = MagicMock()
        response.role = "assistant"
        response.content = [MagicMock(type="text", text='{"city": "Seattle", "temp": 72}')]
        response.stop_reason = "end_turn"

        result = _process_response(agent, response)
        assert isinstance(result, StructuredResult)
        assert result["city"] == "Seattle"
        assert result["temp"] == 72
        assert result._raw_json == '{"city": "Seattle", "temp": 72}'


# --- Import re-export tests ---


class TestReExports:
    def test_import_from_core(self):
        from prompty.core import StructuredResult, cast

        assert StructuredResult is not None
        assert cast is not None

    def test_import_from_top_level(self):
        from prompty import StructuredResult, cast

        assert StructuredResult is not None
        assert cast is not None

    def test_import_from_invoker(self):
        from prompty.invoker import StructuredResult, cast

        assert StructuredResult is not None
        assert cast is not None

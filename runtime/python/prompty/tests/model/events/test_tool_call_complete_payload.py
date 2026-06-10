import json

import yaml

from prompty.model import ToolCallCompletePayload


def test_load_json_toolcallcompletepayload():
    json_data = r"""
    {
      "id": "call_abc123",
      "name": "get_weather",
      "success": true,
      "durationMs": 42,
      "errorKind": "timeout"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolCallCompletePayload.load(data)
    assert instance is not None
    assert instance.id == "call_abc123"
    assert instance.name == "get_weather"
    assert instance.success
    assert instance.duration_ms == 42
    assert instance.error_kind == "timeout"


def test_load_yaml_toolcallcompletepayload():
    yaml_data = r"""
    id: call_abc123
    name: get_weather
    success: true
    durationMs: 42
    errorKind: timeout

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ToolCallCompletePayload.load(data)
    assert instance is not None
    assert instance.id == "call_abc123"
    assert instance.name == "get_weather"
    assert instance.success
    assert instance.duration_ms == 42
    assert instance.error_kind == "timeout"


def test_roundtrip_json_toolcallcompletepayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "id": "call_abc123",
      "name": "get_weather",
      "success": true,
      "durationMs": 42,
      "errorKind": "timeout"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ToolCallCompletePayload.load(original_data)
    saved_data = instance.save()
    reloaded = ToolCallCompletePayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.id == "call_abc123"
    assert reloaded.name == "get_weather"
    assert reloaded.success
    assert reloaded.duration_ms == 42
    assert reloaded.error_kind == "timeout"


def test_to_json_toolcallcompletepayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "id": "call_abc123",
      "name": "get_weather",
      "success": true,
      "durationMs": 42,
      "errorKind": "timeout"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolCallCompletePayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_toolcallcompletepayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "id": "call_abc123",
      "name": "get_weather",
      "success": true,
      "durationMs": 42,
      "errorKind": "timeout"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolCallCompletePayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

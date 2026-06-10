import json

import yaml

from prompty.model import ToolCallStartPayload


def test_load_json_toolcallstartpayload():
    json_data = r"""
    {
      "id": "call_abc123",
      "name": "get_weather",
      "arguments": "{\"city\": \"Paris\"}"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolCallStartPayload.load(data)
    assert instance is not None
    assert instance.id == "call_abc123"
    assert instance.name == "get_weather"
    assert instance.arguments == '{"city": "Paris"}'


def test_load_yaml_toolcallstartpayload():
    yaml_data = r"""
    id: call_abc123
    name: get_weather
    arguments: "{\"city\": \"Paris\"}"

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ToolCallStartPayload.load(data)
    assert instance is not None
    assert instance.id == "call_abc123"
    assert instance.name == "get_weather"
    assert instance.arguments == '{"city": "Paris"}'


def test_roundtrip_json_toolcallstartpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "id": "call_abc123",
      "name": "get_weather",
      "arguments": "{\"city\": \"Paris\"}"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ToolCallStartPayload.load(original_data)
    saved_data = instance.save()
    reloaded = ToolCallStartPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.id == "call_abc123"
    assert reloaded.name == "get_weather"
    assert reloaded.arguments == '{"city": "Paris"}'


def test_to_json_toolcallstartpayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "id": "call_abc123",
      "name": "get_weather",
      "arguments": "{\"city\": \"Paris\"}"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolCallStartPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_toolcallstartpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "id": "call_abc123",
      "name": "get_weather",
      "arguments": "{\"city\": \"Paris\"}"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolCallStartPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

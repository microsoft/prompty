import json

import yaml

from prompty.model import DoneEventPayload


def test_load_json_doneeventpayload():
    json_data = r"""
    {
      "response": "The weather in Paris is 72°F and sunny."
    }
    """
    data = json.loads(json_data, strict=False)
    instance = DoneEventPayload.load(data)
    assert instance is not None
    assert instance.response == "The weather in Paris is 72°F and sunny."


def test_load_yaml_doneeventpayload():
    yaml_data = r"""
    response: The weather in Paris is 72°F and sunny.
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = DoneEventPayload.load(data)
    assert instance is not None
    assert instance.response == "The weather in Paris is 72°F and sunny."


def test_roundtrip_json_doneeventpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "response": "The weather in Paris is 72°F and sunny."
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = DoneEventPayload.load(original_data)
    saved_data = instance.save()
    reloaded = DoneEventPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.response == "The weather in Paris is 72°F and sunny."


def test_to_json_doneeventpayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "response": "The weather in Paris is 72°F and sunny."
    }
    """
    data = json.loads(json_data, strict=False)
    instance = DoneEventPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_doneeventpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "response": "The weather in Paris is 72°F and sunny."
    }
    """
    data = json.loads(json_data, strict=False)
    instance = DoneEventPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

import json

import yaml

from prompty.model import ThinkingEventPayload


def test_load_json_thinkingeventpayload():
    json_data = r"""
    {
      "token": "Let me consider..."
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ThinkingEventPayload.load(data)
    assert instance is not None
    assert instance.token == "Let me consider..."


def test_load_yaml_thinkingeventpayload():
    yaml_data = r"""
    token: Let me consider...
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ThinkingEventPayload.load(data)
    assert instance is not None
    assert instance.token == "Let me consider..."


def test_roundtrip_json_thinkingeventpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "token": "Let me consider..."
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ThinkingEventPayload.load(original_data)
    saved_data = instance.save()
    reloaded = ThinkingEventPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.token == "Let me consider..."


def test_to_json_thinkingeventpayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "token": "Let me consider..."
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ThinkingEventPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_thinkingeventpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "token": "Let me consider..."
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ThinkingEventPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

import json

import yaml

from prompty.model import StatusEventPayload


def test_load_json_statuseventpayload():
    json_data = r"""
    {
      "message": "Starting iteration 3"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = StatusEventPayload.load(data)
    assert instance is not None
    assert instance.message == "Starting iteration 3"


def test_load_yaml_statuseventpayload():
    yaml_data = r"""
    message: Starting iteration 3
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = StatusEventPayload.load(data)
    assert instance is not None
    assert instance.message == "Starting iteration 3"


def test_roundtrip_json_statuseventpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "message": "Starting iteration 3"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = StatusEventPayload.load(original_data)
    saved_data = instance.save()
    reloaded = StatusEventPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.message == "Starting iteration 3"


def test_to_json_statuseventpayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "message": "Starting iteration 3"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = StatusEventPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_statuseventpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "message": "Starting iteration 3"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = StatusEventPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

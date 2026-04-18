import json

import yaml

from prompty.model import CompactionFailedPayload


def test_load_json_compactionfailedpayload():
    json_data = r"""
    {
      "message": "Summarization prompt exceeded context window"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = CompactionFailedPayload.load(data)
    assert instance is not None
    assert instance.message == "Summarization prompt exceeded context window"


def test_load_yaml_compactionfailedpayload():
    yaml_data = r"""
    message: Summarization prompt exceeded context window
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = CompactionFailedPayload.load(data)
    assert instance is not None
    assert instance.message == "Summarization prompt exceeded context window"


def test_roundtrip_json_compactionfailedpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "message": "Summarization prompt exceeded context window"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = CompactionFailedPayload.load(original_data)
    saved_data = instance.save()
    reloaded = CompactionFailedPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.message == "Summarization prompt exceeded context window"


def test_to_json_compactionfailedpayload():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "message": "Summarization prompt exceeded context window"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = CompactionFailedPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_compactionfailedpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "message": "Summarization prompt exceeded context window"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = CompactionFailedPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

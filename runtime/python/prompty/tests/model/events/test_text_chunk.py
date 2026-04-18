import json

import yaml

from prompty.model import TextChunk


def test_load_json_textchunk():
    json_data = r"""
    {
      "value": "Hello"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TextChunk.load(data)
    assert instance is not None
    assert instance.value == "Hello"


def test_load_yaml_textchunk():
    yaml_data = r"""
    value: Hello
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = TextChunk.load(data)
    assert instance is not None
    assert instance.value == "Hello"


def test_roundtrip_json_textchunk():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "value": "Hello"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = TextChunk.load(original_data)
    saved_data = instance.save()
    reloaded = TextChunk.load(saved_data)
    assert reloaded is not None
    assert reloaded.value == "Hello"


def test_to_json_textchunk():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "value": "Hello"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TextChunk.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_textchunk():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "value": "Hello"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = TextChunk.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

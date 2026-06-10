import json

import yaml

from prompty.model import StreamOptions


def test_load_json_streamoptions():
    json_data = r"""
    {
      "includeUsage": true
    }
    """
    data = json.loads(json_data, strict=False)
    instance = StreamOptions.load(data)
    assert instance is not None
    assert instance.include_usage


def test_load_yaml_streamoptions():
    yaml_data = r"""
    includeUsage: true

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = StreamOptions.load(data)
    assert instance is not None
    assert instance.include_usage


def test_roundtrip_json_streamoptions():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "includeUsage": true
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = StreamOptions.load(original_data)
    saved_data = instance.save()
    reloaded = StreamOptions.load(saved_data)
    assert reloaded is not None
    assert reloaded.include_usage


def test_to_json_streamoptions():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "includeUsage": true
    }
    """
    data = json.loads(json_data, strict=False)
    instance = StreamOptions.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_streamoptions():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "includeUsage": true
    }
    """
    data = json.loads(json_data, strict=False)
    instance = StreamOptions.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

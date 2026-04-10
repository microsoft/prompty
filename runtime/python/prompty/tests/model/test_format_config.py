import json

import yaml

from prompty.model import FormatConfig


def test_load_json_formatconfig():
    json_data = r"""
    {
      "kind": "mustache",
      "strict": true,
      "options": {
        "key": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FormatConfig.load(data)
    assert instance is not None
    assert instance.kind == "mustache"

    assert instance.strict


def test_load_yaml_formatconfig():
    yaml_data = r"""
    kind: mustache
    strict: true
    options:
      key: value
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = FormatConfig.load(data)
    assert instance is not None
    assert instance.kind == "mustache"
    assert instance.strict


def test_roundtrip_json_formatconfig():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "mustache",
      "strict": true,
      "options": {
        "key": "value"
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = FormatConfig.load(original_data)
    saved_data = instance.save()
    reloaded = FormatConfig.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "mustache"
    assert reloaded.strict


def test_to_json_formatconfig():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "mustache",
      "strict": true,
      "options": {
        "key": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FormatConfig.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_formatconfig():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "mustache",
      "strict": true,
      "options": {
        "key": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FormatConfig.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_formatconfig_from_str():
    instance = FormatConfig.load("example")
    assert instance is not None
    assert instance.kind == "example"

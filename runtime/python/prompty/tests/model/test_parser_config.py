import json

import yaml

from prompty.model import ParserConfig


def test_load_json_parserconfig():
    json_data = r"""
    {
      "kind": "prompty",
      "options": {
        "key": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ParserConfig.load(data)
    assert instance is not None
    assert instance.kind == "prompty"


def test_load_yaml_parserconfig():
    yaml_data = r"""
    kind: prompty
    options:
      key: value
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ParserConfig.load(data)
    assert instance is not None
    assert instance.kind == "prompty"


def test_roundtrip_json_parserconfig():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "prompty",
      "options": {
        "key": "value"
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ParserConfig.load(original_data)
    saved_data = instance.save()
    reloaded = ParserConfig.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "prompty"


def test_to_json_parserconfig():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "prompty",
      "options": {
        "key": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ParserConfig.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_parserconfig():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "prompty",
      "options": {
        "key": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ParserConfig.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_parserconfig_from_str():
    instance = ParserConfig.load("example")
    assert instance is not None
    assert instance.kind == "example"

import json

import yaml

from prompty.model import ArrayProperty


def test_load_json_arrayproperty():
    json_data = r"""
    {
      "items": {
        "kind": "string"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ArrayProperty.load(data)
    assert instance is not None


def test_load_yaml_arrayproperty():
    yaml_data = r"""
    items:
      kind: string
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ArrayProperty.load(data)
    assert instance is not None


def test_roundtrip_json_arrayproperty():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "items": {
        "kind": "string"
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ArrayProperty.load(original_data)
    saved_data = instance.save()
    reloaded = ArrayProperty.load(saved_data)
    assert reloaded is not None


def test_to_json_arrayproperty():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "items": {
        "kind": "string"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ArrayProperty.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_arrayproperty():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "items": {
        "kind": "string"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ArrayProperty.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

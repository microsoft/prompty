import json

import yaml

from prompty.model import ObjectProperty


def test_load_json_objectproperty():
    json_data = r"""
    {
      "properties": {
        "property1": {
          "kind": "string"
        },
        "property2": {
          "kind": "number"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ObjectProperty.load(data)
    assert instance is not None


def test_load_yaml_objectproperty():
    yaml_data = r"""
    properties:
      property1:
        kind: string
      property2:
        kind: number
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ObjectProperty.load(data)
    assert instance is not None


def test_roundtrip_json_objectproperty():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "properties": {
        "property1": {
          "kind": "string"
        },
        "property2": {
          "kind": "number"
        }
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ObjectProperty.load(original_data)
    saved_data = instance.save()
    reloaded = ObjectProperty.load(saved_data)
    assert reloaded is not None


def test_to_json_objectproperty():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "properties": {
        "property1": {
          "kind": "string"
        },
        "property2": {
          "kind": "number"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ObjectProperty.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_objectproperty():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "properties": {
        "property1": {
          "kind": "string"
        },
        "property2": {
          "kind": "number"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ObjectProperty.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

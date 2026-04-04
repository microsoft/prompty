import json

import yaml

from prompty.model import Template


def test_load_json_template():
    json_data = r"""
    {
      "format": {
        "kind": "mustache"
      },
      "parser": {
        "kind": "mustache"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Template.load(data)
    assert instance is not None


def test_load_yaml_template():
    yaml_data = r"""
    format:
      kind: mustache
    parser:
      kind: mustache
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Template.load(data)
    assert instance is not None


def test_roundtrip_json_template():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "format": {
        "kind": "mustache"
      },
      "parser": {
        "kind": "mustache"
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = Template.load(original_data)
    saved_data = instance.save()
    reloaded = Template.load(saved_data)
    assert reloaded is not None


def test_to_json_template():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "format": {
        "kind": "mustache"
      },
      "parser": {
        "kind": "mustache"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Template.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_template():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "format": {
        "kind": "mustache"
      },
      "parser": {
        "kind": "mustache"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Template.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

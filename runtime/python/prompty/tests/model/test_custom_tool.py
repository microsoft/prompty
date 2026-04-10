import json

import yaml

from prompty.model import CustomTool


def test_load_json_customtool():
    json_data = r"""
    {
      "connection": {
        "kind": "reference"
      },
      "options": {
        "timeout": 30,
        "retries": 3
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = CustomTool.load(data)
    assert instance is not None


def test_load_yaml_customtool():
    yaml_data = r"""
    connection:
      kind: reference
    options:
      timeout: 30
      retries: 3
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = CustomTool.load(data)
    assert instance is not None


def test_roundtrip_json_customtool():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "connection": {
        "kind": "reference"
      },
      "options": {
        "timeout": 30,
        "retries": 3
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = CustomTool.load(original_data)
    saved_data = instance.save()
    reloaded = CustomTool.load(saved_data)
    assert reloaded is not None


def test_to_json_customtool():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "connection": {
        "kind": "reference"
      },
      "options": {
        "timeout": 30,
        "retries": 3
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = CustomTool.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_customtool():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "connection": {
        "kind": "reference"
      },
      "options": {
        "timeout": 30,
        "retries": 3
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = CustomTool.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

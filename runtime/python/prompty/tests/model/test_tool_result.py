import json

import yaml

from prompty.model import ToolResult


def test_load_json_toolresult():
    json_data = r"""
    {
      "parts": [
        {
          "kind": "text",
          "value": "72°F and sunny"
        }
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolResult.load(data)
    assert instance is not None


def test_load_yaml_toolresult():
    yaml_data = r"""
    parts:
      - kind: text
        value: 72°F and sunny
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ToolResult.load(data)
    assert instance is not None


def test_roundtrip_json_toolresult():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "parts": [
        {
          "kind": "text",
          "value": "72°F and sunny"
        }
      ]
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ToolResult.load(original_data)
    saved_data = instance.save()
    reloaded = ToolResult.load(saved_data)
    assert reloaded is not None


def test_to_json_toolresult():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "parts": [
        {
          "kind": "text",
          "value": "72°F and sunny"
        }
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolResult.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_toolresult():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "parts": [
        {
          "kind": "text",
          "value": "72°F and sunny"
        }
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ToolResult.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

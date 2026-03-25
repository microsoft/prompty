import json

import yaml

from prompty.model import Tool


def test_load_json_tool():
    json_data = r"""
    {
      "name": "my-tool",
      "kind": "function",
      "description": "A description of the tool",
      "bindings": {
        "input": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Tool.load(data)
    assert instance is not None
    assert instance.name == "my-tool"
    assert instance.kind == "function"
    assert instance.description == "A description of the tool"


def test_load_yaml_tool():
    yaml_data = r"""
    name: my-tool
    kind: function
    description: A description of the tool
    bindings:
      input: value
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Tool.load(data)
    assert instance is not None
    assert instance.name == "my-tool"
    assert instance.kind == "function"
    assert instance.description == "A description of the tool"


def test_roundtrip_json_tool():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "name": "my-tool",
      "kind": "function",
      "description": "A description of the tool",
      "bindings": {
        "input": "value"
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = Tool.load(original_data)
    saved_data = instance.save()
    reloaded = Tool.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "my-tool"
    assert reloaded.kind == "function"
    assert reloaded.description == "A description of the tool"


def test_to_json_tool():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "name": "my-tool",
      "kind": "function",
      "description": "A description of the tool",
      "bindings": {
        "input": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Tool.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_tool():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "name": "my-tool",
      "kind": "function",
      "description": "A description of the tool",
      "bindings": {
        "input": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Tool.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

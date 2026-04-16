import json

import yaml

from prompty.model import Binding


def test_load_json_binding():
    json_data = r"""
    {
      "name": "my-tool",
      "input": "input-variable"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Binding.load(data)
    assert instance is not None
    assert instance.name == "my-tool"
    assert instance.input == "input-variable"


def test_load_yaml_binding():
    yaml_data = r"""
    name: my-tool
    input: input-variable
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Binding.load(data)
    assert instance is not None
    assert instance.name == "my-tool"
    assert instance.input == "input-variable"


def test_roundtrip_json_binding():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "name": "my-tool",
      "input": "input-variable"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = Binding.load(original_data)
    saved_data = instance.save()
    reloaded = Binding.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "my-tool"
    assert reloaded.input == "input-variable"


def test_to_json_binding():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "name": "my-tool",
      "input": "input-variable"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Binding.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_binding():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "name": "my-tool",
      "input": "input-variable"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Binding.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_binding_from_str():
    instance = Binding.load("example")
    assert instance is not None
    assert instance.input == "example"

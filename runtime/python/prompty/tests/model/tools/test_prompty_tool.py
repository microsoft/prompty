import json

import yaml

from prompty.model import PromptyTool


def test_load_json_promptytool():
    json_data = r"""
    {
      "kind": "prompty",
      "path": "./summarize.prompty",
      "mode": "single"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyTool.load(data)
    assert instance is not None
    assert instance.kind == "prompty"
    assert instance.path == "./summarize.prompty"
    assert instance.mode == "single"


def test_load_yaml_promptytool():
    yaml_data = r"""
    kind: prompty
    path: ./summarize.prompty
    mode: single
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyTool.load(data)
    assert instance is not None
    assert instance.kind == "prompty"
    assert instance.path == "./summarize.prompty"
    assert instance.mode == "single"


def test_roundtrip_json_promptytool():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "prompty",
      "path": "./summarize.prompty",
      "mode": "single"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = PromptyTool.load(original_data)
    saved_data = instance.save()
    reloaded = PromptyTool.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "prompty"
    assert reloaded.path == "./summarize.prompty"
    assert reloaded.mode == "single"


def test_to_json_promptytool():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "prompty",
      "path": "./summarize.prompty",
      "mode": "single"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyTool.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_promptytool():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "prompty",
      "path": "./summarize.prompty",
      "mode": "single"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyTool.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

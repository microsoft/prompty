import json

import yaml

from prompty.model import OpenApiTool


def test_load_json_openapitool():
    json_data = r"""
    {
      "kind": "openapi",
      "connection": {
        "kind": "reference"
      },
      "specification": "./openapi.json"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = OpenApiTool.load(data)
    assert instance is not None
    assert instance.kind == "openapi"
    assert instance.specification == "./openapi.json"


def test_load_yaml_openapitool():
    yaml_data = r"""
    kind: openapi
    connection:
      kind: reference
    specification: ./openapi.json
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = OpenApiTool.load(data)
    assert instance is not None
    assert instance.kind == "openapi"
    assert instance.specification == "./openapi.json"


def test_roundtrip_json_openapitool():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "openapi",
      "connection": {
        "kind": "reference"
      },
      "specification": "./openapi.json"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = OpenApiTool.load(original_data)
    saved_data = instance.save()
    reloaded = OpenApiTool.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "openapi"
    assert reloaded.specification == "./openapi.json"


def test_to_json_openapitool():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "openapi",
      "connection": {
        "kind": "reference"
      },
      "specification": "./openapi.json"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = OpenApiTool.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_openapitool():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "openapi",
      "connection": {
        "kind": "reference"
      },
      "specification": "./openapi.json"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = OpenApiTool.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

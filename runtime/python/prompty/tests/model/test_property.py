import json

import yaml

from prompty.model import Property


def test_load_json_property():
    json_data = r"""
    {
      "name": "my-input",
      "kind": "string",
      "description": "A description of the input property",
      "required": true,
      "default": "default value",
      "example": "example value",
      "enumValues": [
        "value1",
        "value2",
        "value3"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Property.load(data)
    assert instance is not None
    assert instance.name == "my-input"
    assert instance.kind == "string"
    assert instance.description == "A description of the input property"

    assert instance.required
    assert instance.default == "default value"
    assert instance.example == "example value"


def test_load_yaml_property():
    yaml_data = r"""
    name: my-input
    kind: string
    description: A description of the input property
    required: true
    default: default value
    example: example value
    enumValues:
      - value1
      - value2
      - value3
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Property.load(data)
    assert instance is not None
    assert instance.name == "my-input"
    assert instance.kind == "string"
    assert instance.description == "A description of the input property"
    assert instance.required
    assert instance.default == "default value"
    assert instance.example == "example value"


def test_roundtrip_json_property():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "name": "my-input",
      "kind": "string",
      "description": "A description of the input property",
      "required": true,
      "default": "default value",
      "example": "example value",
      "enumValues": [
        "value1",
        "value2",
        "value3"
      ]
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = Property.load(original_data)
    saved_data = instance.save()
    reloaded = Property.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "my-input"
    assert reloaded.kind == "string"
    assert reloaded.description == "A description of the input property"
    assert reloaded.required
    assert reloaded.default == "default value"
    assert reloaded.example == "example value"


def test_to_json_property():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "name": "my-input",
      "kind": "string",
      "description": "A description of the input property",
      "required": true,
      "default": "default value",
      "example": "example value",
      "enumValues": [
        "value1",
        "value2",
        "value3"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Property.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_property():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "name": "my-input",
      "kind": "string",
      "description": "A description of the input property",
      "required": true,
      "default": "default value",
      "example": "example value",
      "enumValues": [
        "value1",
        "value2",
        "value3"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Property.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_property_from_bool():
    instance = Property.load(False)
    assert instance is not None
    assert instance.kind == "boolean"
    assert not instance.example


def test_load_property_from_float():
    instance = Property.load(3.14)
    assert instance is not None
    assert instance.kind == "float"
    assert instance.example == 3.14


def test_load_property_from_integer():
    instance = Property.load(4)
    assert instance is not None
    assert instance.kind == "integer"
    assert instance.example == 4


def test_load_property_from_str():
    instance = Property.load("example")
    assert instance is not None
    assert instance.kind == "string"
    assert instance.example == "example"

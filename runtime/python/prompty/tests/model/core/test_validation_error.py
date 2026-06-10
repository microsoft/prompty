import json

import yaml

from prompty.model import ValidationError


def test_load_json_validationerror():
    json_data = r"""
    {
      "message": "Missing required input: firstName",
      "property": "firstName",
      "constraint": "required"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ValidationError.load(data)
    assert instance is not None
    assert instance.message == "Missing required input: firstName"
    assert instance.property == "firstName"
    assert instance.constraint == "required"


def test_load_yaml_validationerror():
    yaml_data = r"""
    message: "Missing required input: firstName"
    property: firstName
    constraint: required

    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ValidationError.load(data)
    assert instance is not None
    assert instance.message == "Missing required input: firstName"
    assert instance.property == "firstName"
    assert instance.constraint == "required"


def test_roundtrip_json_validationerror():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "message": "Missing required input: firstName",
      "property": "firstName",
      "constraint": "required"
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ValidationError.load(original_data)
    saved_data = instance.save()
    reloaded = ValidationError.load(saved_data)
    assert reloaded is not None
    assert reloaded.message == "Missing required input: firstName"
    assert reloaded.property == "firstName"
    assert reloaded.constraint == "required"


def test_to_json_validationerror():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "message": "Missing required input: firstName",
      "property": "firstName",
      "constraint": "required"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ValidationError.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_validationerror():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "message": "Missing required input: firstName",
      "property": "firstName",
      "constraint": "required"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ValidationError.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

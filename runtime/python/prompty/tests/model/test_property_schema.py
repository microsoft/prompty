import json

import yaml

from prompty.model import PropertySchema


def test_load_json_propertyschema():
    json_data = r"""
    {
      "examples": [
        {
          "key": "value"
        }
      ],
      "strict": true,
      "properties": {
        "firstName": {
          "kind": "string",
          "sample": "Jane"
        },
        "lastName": {
          "kind": "string",
          "sample": "Doe"
        },
        "question": {
          "kind": "string",
          "sample": "What is the meaning of life?"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PropertySchema.load(data)
    assert instance is not None

    assert instance.strict


def test_load_yaml_propertyschema():
    yaml_data = r"""
    examples:
      - key: value
    strict: true
    properties:
      firstName:
        kind: string
        sample: Jane
      lastName:
        kind: string
        sample: Doe
      question:
        kind: string
        sample: What is the meaning of life?
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PropertySchema.load(data)
    assert instance is not None
    assert instance.strict


def test_roundtrip_json_propertyschema():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "examples": [
        {
          "key": "value"
        }
      ],
      "strict": true,
      "properties": {
        "firstName": {
          "kind": "string",
          "sample": "Jane"
        },
        "lastName": {
          "kind": "string",
          "sample": "Doe"
        },
        "question": {
          "kind": "string",
          "sample": "What is the meaning of life?"
        }
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = PropertySchema.load(original_data)
    saved_data = instance.save()
    reloaded = PropertySchema.load(saved_data)
    assert reloaded is not None
    assert reloaded.strict


def test_to_json_propertyschema():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "examples": [
        {
          "key": "value"
        }
      ],
      "strict": true,
      "properties": {
        "firstName": {
          "kind": "string",
          "sample": "Jane"
        },
        "lastName": {
          "kind": "string",
          "sample": "Doe"
        },
        "question": {
          "kind": "string",
          "sample": "What is the meaning of life?"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PropertySchema.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_propertyschema():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "examples": [
        {
          "key": "value"
        }
      ],
      "strict": true,
      "properties": {
        "firstName": {
          "kind": "string",
          "sample": "Jane"
        },
        "lastName": {
          "kind": "string",
          "sample": "Doe"
        },
        "question": {
          "kind": "string",
          "sample": "What is the meaning of life?"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PropertySchema.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

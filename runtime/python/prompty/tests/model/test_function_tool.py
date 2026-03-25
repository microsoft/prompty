import json

import yaml

from prompty.model import FunctionTool


def test_load_json_functiontool():
    json_data = r"""
    {
      "kind": "function",
      "parameters": {
        "firstName": {
          "kind": "string",
          "default": "Jane"
        },
        "lastName": {
          "kind": "string",
          "default": "Doe"
        },
        "question": {
          "kind": "string",
          "default": "What is the meaning of life?"
        }
      },
      "strict": true
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FunctionTool.load(data)
    assert instance is not None
    assert instance.kind == "function"

    assert instance.strict


def test_load_yaml_functiontool():
    yaml_data = r"""
    kind: function
    parameters:
      firstName:
        kind: string
        default: Jane
      lastName:
        kind: string
        default: Doe
      question:
        kind: string
        default: What is the meaning of life?
    strict: true
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = FunctionTool.load(data)
    assert instance is not None
    assert instance.kind == "function"
    assert instance.strict


def test_roundtrip_json_functiontool():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "function",
      "parameters": {
        "firstName": {
          "kind": "string",
          "default": "Jane"
        },
        "lastName": {
          "kind": "string",
          "default": "Doe"
        },
        "question": {
          "kind": "string",
          "default": "What is the meaning of life?"
        }
      },
      "strict": true
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = FunctionTool.load(original_data)
    saved_data = instance.save()
    reloaded = FunctionTool.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "function"
    assert reloaded.strict


def test_to_json_functiontool():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "function",
      "parameters": {
        "firstName": {
          "kind": "string",
          "default": "Jane"
        },
        "lastName": {
          "kind": "string",
          "default": "Doe"
        },
        "question": {
          "kind": "string",
          "default": "What is the meaning of life?"
        }
      },
      "strict": true
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FunctionTool.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_functiontool():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "function",
      "parameters": {
        "firstName": {
          "kind": "string",
          "default": "Jane"
        },
        "lastName": {
          "kind": "string",
          "default": "Doe"
        },
        "question": {
          "kind": "string",
          "default": "What is the meaning of life?"
        }
      },
      "strict": true
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FunctionTool.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_json_functiontool_1():
    json_data = r"""
    {
      "kind": "function",
      "parameters": [
        {
          "name": "firstName",
          "kind": "string",
          "default": "Jane"
        },
        {
          "name": "lastName",
          "kind": "string",
          "default": "Doe"
        },
        {
          "name": "question",
          "kind": "string",
          "default": "What is the meaning of life?"
        }
      ],
      "strict": true
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FunctionTool.load(data)
    assert instance is not None
    assert instance.kind == "function"

    assert instance.strict


def test_load_yaml_functiontool_1():
    yaml_data = r"""
    kind: function
    parameters:
      - name: firstName
        kind: string
        default: Jane
      - name: lastName
        kind: string
        default: Doe
      - name: question
        kind: string
        default: What is the meaning of life?
    strict: true
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = FunctionTool.load(data)
    assert instance is not None
    assert instance.kind == "function"
    assert instance.strict


def test_roundtrip_json_functiontool_1():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "kind": "function",
      "parameters": [
        {
          "name": "firstName",
          "kind": "string",
          "default": "Jane"
        },
        {
          "name": "lastName",
          "kind": "string",
          "default": "Doe"
        },
        {
          "name": "question",
          "kind": "string",
          "default": "What is the meaning of life?"
        }
      ],
      "strict": true
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = FunctionTool.load(original_data)
    saved_data = instance.save()
    reloaded = FunctionTool.load(saved_data)
    assert reloaded is not None
    assert reloaded.kind == "function"
    assert reloaded.strict


def test_to_json_functiontool_1():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "kind": "function",
      "parameters": [
        {
          "name": "firstName",
          "kind": "string",
          "default": "Jane"
        },
        {
          "name": "lastName",
          "kind": "string",
          "default": "Doe"
        },
        {
          "name": "question",
          "kind": "string",
          "default": "What is the meaning of life?"
        }
      ],
      "strict": true
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FunctionTool.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_functiontool_1():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "kind": "function",
      "parameters": [
        {
          "name": "firstName",
          "kind": "string",
          "default": "Jane"
        },
        {
          "name": "lastName",
          "kind": "string",
          "default": "Doe"
        },
        {
          "name": "question",
          "kind": "string",
          "default": "What is the meaning of life?"
        }
      ],
      "strict": true
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FunctionTool.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

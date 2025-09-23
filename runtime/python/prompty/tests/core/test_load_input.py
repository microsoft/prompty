import json

import yaml

from prompty.core import Input


def test_create_input():
    instance = Input()
    assert instance is not None


def test_load_json_input():
    json_data = """
    {
      "name": "my-input",
      "kind": "string",
      "description": "A description of the input property",
      "required": true,
      "strict": true,
      "default": "default value",
      "sample": "sample value"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Input.load(data)
    assert instance is not None
    assert instance.name == "my-input"
    assert instance.kind == "string"
    assert instance.description == "A description of the input property"

    assert instance.required

    assert instance.strict
    assert instance.default == "default value"
    assert instance.sample == "sample value"


def test_load_yaml_input():
    yaml_data = """
    name: my-input
    kind: string
    description: A description of the input property
    required: true
    strict: true
    default: default value
    sample: sample value
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Input.load(data)
    assert instance is not None
    assert instance.name == "my-input"
    assert instance.kind == "string"
    assert instance.description == "A description of the input property"
    assert instance.required
    assert instance.strict
    assert instance.default == "default value"
    assert instance.sample == "sample value"


def test_load_input_from_boolean():
    instance = Input.load(False)
    assert instance is not None
    assert instance.kind == "boolean"
    assert not instance.sample


def test_load_input_from_float32():
    instance = Input.load(3.14)
    assert instance is not None
    assert instance.kind == "float"
    assert instance.sample == 3.14


def test_load_input_from_integer():
    instance = Input.load(3)
    assert instance is not None
    assert instance.kind == "integer"
    assert instance.sample == 3


def test_load_input_from_string():
    instance = Input.load("example")
    assert instance is not None
    assert instance.kind == "string"
    assert instance.sample == "example"

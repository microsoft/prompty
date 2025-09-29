import json

import yaml

from prompty.core import Parameter


def test_load_json_parameter():
    json_data = """
    {
      "name": "my-parameter",
      "kind": "string",
      "description": "A description of the parameter",
      "required": true,
      "default": "default value",
      "value": "sample value",
      "enum": [
        "value1",
        "value2",
        "value3"
      ]
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Parameter.load(data)
    assert instance is not None
    assert instance.name == "my-parameter"
    assert instance.kind == "string"
    assert instance.description == "A description of the parameter"

    assert instance.required
    assert instance.default == "default value"
    assert instance.value == "sample value"


def test_load_yaml_parameter():
    yaml_data = """
    name: my-parameter
    kind: string
    description: A description of the parameter
    required: true
    default: default value
    value: sample value
    enum:
      - value1
      - value2
      - value3
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Parameter.load(data)
    assert instance is not None
    assert instance.name == "my-parameter"
    assert instance.kind == "string"
    assert instance.description == "A description of the parameter"
    assert instance.required
    assert instance.default == "default value"
    assert instance.value == "sample value"

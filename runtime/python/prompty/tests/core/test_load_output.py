import json

import yaml

from prompty.core import Output


def test_create_output():
    instance = Output()
    assert instance is not None


def test_load_json_output():
    json_data = """
    {
      "name": "my-output",
      "kind": "string",
      "description": "A description of the output property",
      "required": true
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Output.load(data)
    assert instance is not None
    assert instance.name == "my-output"
    assert instance.kind == "string"
    assert instance.description == "A description of the output property"

    assert instance.required


def test_load_yaml_output():
    yaml_data = """
    name: my-output
    kind: string
    description: A description of the output property
    required: true
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Output.load(data)
    assert instance is not None
    assert instance.name == "my-output"
    assert instance.kind == "string"
    assert instance.description == "A description of the output property"
    assert instance.required

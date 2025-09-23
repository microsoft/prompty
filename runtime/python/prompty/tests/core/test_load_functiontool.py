import json

import yaml

from prompty.core import FunctionTool


def test_create_functiontool():
    instance = FunctionTool()
    assert instance is not None


def test_load_json_functiontool():
    json_data = """
    {
      "kind": "function",
      "parameters": {
        "param1": {
          "kind": "string"
        },
        "param2": {
          "kind": "number"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FunctionTool.load(data)
    assert instance is not None
    assert instance.kind == "function"


def test_load_yaml_functiontool():
    yaml_data = """
    kind: function
    parameters:
      param1:
        kind: string
      param2:
        kind: number
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = FunctionTool.load(data)
    assert instance is not None
    assert instance.kind == "function"

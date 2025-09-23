import json

import yaml

from prompty.core import ArrayParameter


def test_create_arrayparameter():
    instance = ArrayParameter()
    assert instance is not None


def test_load_json_arrayparameter():
    json_data = """
    {
      "items": {
        "kind": "string"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ArrayParameter.load(data)
    assert instance is not None


def test_load_yaml_arrayparameter():
    yaml_data = """
    items:
      kind: string
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ArrayParameter.load(data)
    assert instance is not None

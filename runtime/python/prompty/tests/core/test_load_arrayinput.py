import json

import yaml

from prompty.core import ArrayInput


def test_load_json_arrayinput():
    json_data = """
    {
      "items": {
        "kind": "string"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ArrayInput.load(data)
    assert instance is not None


def test_load_yaml_arrayinput():
    yaml_data = """
    items:
      kind: string
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ArrayInput.load(data)
    assert instance is not None

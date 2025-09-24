import json

import yaml

from prompty.core import ObjectInput


def test_load_json_objectinput():
    json_data = """
    {
      "properties": {
        "property1": {
          "kind": "string"
        },
        "property2": {
          "kind": "number"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ObjectInput.load(data)
    assert instance is not None


def test_load_yaml_objectinput():
    yaml_data = """
    properties:
      property1:
        kind: string
      property2:
        kind: number
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ObjectInput.load(data)
    assert instance is not None

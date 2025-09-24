import json

import yaml

from prompty.core import ObjectOutput


def test_load_json_objectoutput():
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
    instance = ObjectOutput.load(data)
    assert instance is not None


def test_load_yaml_objectoutput():
    yaml_data = """
    properties:
      property1:
        kind: string
      property2:
        kind: number
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ObjectOutput.load(data)
    assert instance is not None

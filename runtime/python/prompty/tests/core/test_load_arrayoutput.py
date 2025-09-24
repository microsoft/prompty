import json

import yaml

from prompty.core import ArrayOutput


def test_load_json_arrayoutput():
    json_data = """
    {
      "items": {
        "kind": "string"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ArrayOutput.load(data)
    assert instance is not None


def test_load_yaml_arrayoutput():
    yaml_data = """
    items:
      kind: string
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ArrayOutput.load(data)
    assert instance is not None

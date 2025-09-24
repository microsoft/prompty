import json

import yaml

from prompty.core import Parser


def test_load_json_parser():
    json_data = """
    {
      "kind": "prompty",
      "options": {
        "key": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Parser.load(data)
    assert instance is not None
    assert instance.kind == "prompty"


def test_load_yaml_parser():
    yaml_data = """
    kind: prompty
    options:
      key: value
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Parser.load(data)
    assert instance is not None
    assert instance.kind == "prompty"


def test_load_parser_from_string():
    instance = Parser.load("example")
    assert instance is not None
    assert instance.kind == "example"

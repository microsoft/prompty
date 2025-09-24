import json

import yaml

from prompty.core import Format


def test_load_json_format():
    json_data = """
    {
      "kind": "mustache",
      "strict": true,
      "options": {
        "key": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Format.load(data)
    assert instance is not None
    assert instance.kind == "mustache"

    assert instance.strict


def test_load_yaml_format():
    yaml_data = """
    kind: mustache
    strict: true
    options:
      key: value
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Format.load(data)
    assert instance is not None
    assert instance.kind == "mustache"
    assert instance.strict


def test_load_format_from_string():
    instance = Format.load("example")
    assert instance is not None
    assert instance.kind == "example"

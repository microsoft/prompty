import json

import yaml

from prompty.core import Template


def test_create_template():
    instance = Template()
    assert instance is not None


def test_load_json_template():
    json_data = """
    {
      "format": {
        "kind": "mustache"
      },
      "parser": {
        "kind": "mustache"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Template.load(data)
    assert instance is not None


def test_load_yaml_template():
    yaml_data = """
    format:
      kind: mustache
    parser:
      kind: mustache
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Template.load(data)
    assert instance is not None

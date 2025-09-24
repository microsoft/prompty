import json

import yaml

from prompty.core import ReferenceConnection


def test_load_json_referenceconnection():
    json_data = """
    {
      "kind": "reference",
      "name": "my-reference-connection"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ReferenceConnection.load(data)
    assert instance is not None
    assert instance.kind == "reference"
    assert instance.name == "my-reference-connection"


def test_load_yaml_referenceconnection():
    yaml_data = """
    kind: reference
    name: my-reference-connection
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ReferenceConnection.load(data)
    assert instance is not None
    assert instance.kind == "reference"
    assert instance.name == "my-reference-connection"

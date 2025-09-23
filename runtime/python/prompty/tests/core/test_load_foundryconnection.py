import json

import yaml

from prompty.core import FoundryConnection


def test_create_foundryconnection():
    instance = FoundryConnection()
    assert instance is not None


def test_load_json_foundryconnection():
    json_data = """
    {
      "kind": "foundry",
      "type": "index",
      "name": "my-foundry-connection",
      "project": "my-foundry-project"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = FoundryConnection.load(data)
    assert instance is not None
    assert instance.kind == "foundry"
    assert instance.type == "index"
    assert instance.name == "my-foundry-connection"
    assert instance.project == "my-foundry-project"


def test_load_yaml_foundryconnection():
    yaml_data = """
    kind: foundry
    type: index
    name: my-foundry-connection
    project: my-foundry-project
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = FoundryConnection.load(data)
    assert instance is not None
    assert instance.kind == "foundry"
    assert instance.type == "index"
    assert instance.name == "my-foundry-connection"
    assert instance.project == "my-foundry-project"

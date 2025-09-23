import json

import yaml

from prompty.core import Registry


def test_create_registry():
    instance = Registry()
    assert instance is not None


def test_load_json_registry():
    json_data = """
    {
      "kind": "docker",
      "connection": {
        "kind": "key",
        "authority": "system",
        "usageDescription": "Access to the container registry"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Registry.load(data)
    assert instance is not None
    assert instance.kind == "docker"


def test_load_yaml_registry():
    yaml_data = """
    kind: docker
    connection:
      kind: key
      authority: system
      usageDescription: Access to the container registry
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Registry.load(data)
    assert instance is not None
    assert instance.kind == "docker"

import json

from prompty.core import Registry


def test_create_registry():
    instance = Registry()
    assert instance is not None


def test_load_registry():
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

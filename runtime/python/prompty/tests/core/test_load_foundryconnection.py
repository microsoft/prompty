import json

from prompty.core import FoundryConnection


def test_create_foundryconnection():
    instance = FoundryConnection()
    assert instance is not None


def test_load_foundryconnection():
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

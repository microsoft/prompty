import json

from prompty.core import Connection


def test_create_connection():
    instance = Connection()
    assert instance is not None


def test_load_connection():
    json_data = """
    {
      "kind": "oauth",
      "authority": "system",
      "usageDescription": "This will allow the agent to respond to an email on your behalf"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Connection.load(data)
    assert instance is not None
    assert instance.kind == "oauth"
    assert instance.authority == "system"
    assert instance.usageDescription == "This will allow the agent to respond to an email on your behalf"

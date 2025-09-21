import json

from prompty.core import ReferenceConnection


def test_create_referenceconnection():
    instance = ReferenceConnection()
    assert instance is not None


def test_load_referenceconnection():
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

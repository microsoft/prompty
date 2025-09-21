import json

from prompty.core import ArrayParameter


def test_create_arrayparameter():
    instance = ArrayParameter()
    assert instance is not None


def test_load_arrayparameter():
    json_data = """
    {
      "items": {
        "kind": "string"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ArrayParameter.load(data)
    assert instance is not None

import json

from prompty.core import ArrayInput


def test_create_arrayinput():
    instance = ArrayInput()
    assert instance is not None


def test_load_arrayinput():
    json_data = """
    {
      "items": {
        "kind": "string"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ArrayInput.load(data)
    assert instance is not None

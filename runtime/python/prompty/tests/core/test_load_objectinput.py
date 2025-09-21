import json

from prompty.core import ObjectInput


def test_create_objectinput():
    instance = ObjectInput()
    assert instance is not None


def test_load_objectinput():
    json_data = """
    {
      "properties": {
        "property1": {
          "kind": "string"
        },
        "property2": {
          "kind": "number"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ObjectInput.load(data)
    assert instance is not None

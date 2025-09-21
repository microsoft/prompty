import json

from prompty.core import ObjectOutput


def test_create_objectoutput():
    instance = ObjectOutput()
    assert instance is not None


def test_load_objectoutput():
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
    instance = ObjectOutput.load(data)
    assert instance is not None

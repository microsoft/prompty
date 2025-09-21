import json

from prompty.core import ObjectParameter


def test_create_objectparameter():
    instance = ObjectParameter()
    assert instance is not None


def test_load_objectparameter():
    json_data = """
    {
      "properties": {
        "param1": {
          "kind": "string"
        },
        "param2": {
          "kind": "number"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ObjectParameter.load(data)
    assert instance is not None

import json

from prompty.core import ArrayOutput


def test_create_arrayoutput():
    instance = ArrayOutput()
    assert instance is not None


def test_load_arrayoutput():
    json_data = """
    {
      "items": {
        "kind": "string"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ArrayOutput.load(data)
    assert instance is not None

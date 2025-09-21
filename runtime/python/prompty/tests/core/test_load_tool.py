import json

from prompty.core import Tool


def test_create_tool():
    instance = Tool()
    assert instance is not None


def test_load_tool():
    json_data = """
    {
      "name": "my-tool",
      "kind": "function",
      "description": "A description of the tool",
      "bindings": {
        "input": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Tool.load(data)
    assert instance is not None
    assert instance.name == "my-tool"
    assert instance.kind == "function"
    assert instance.description == "A description of the tool"

import json

from prompty.core import Binding


def test_create_binding():
    instance = Binding()
    assert instance is not None


def test_load_binding():
    json_data = """
    {
      "name": "my-tool",
      "input": "input-variable"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Binding.load(data)
    assert instance is not None
    assert instance.name == "my-tool"
    assert instance.input == "input-variable"

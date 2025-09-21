import json

from prompty.core import Parser


def test_create_parser():
    instance = Parser()
    assert instance is not None


def test_load_parser():
    json_data = """
    {
      "kind": "prompty",
      "options": {
        "key": "value"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Parser.load(data)
    assert instance is not None
    assert instance.kind == "prompty"


def test_load_parser_from_string():
    instance = Parser.load("example")
    assert instance is not None
    assert instance.kind == "example"

import json

from prompty.core import Template


def test_create_template():
    instance = Template()
    assert instance is not None


def test_load_template():
    json_data = """
    {
      "format": {
        "kind": "mustache"
      },
      "parser": {
        "kind": "mustache"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Template.load(data)
    assert instance is not None

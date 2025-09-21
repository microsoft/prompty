import json

from prompty.core import ModelTool


def test_create_modeltool():
    instance = ModelTool()
    assert instance is not None


def test_load_modeltool():
    json_data = """
    {
      "kind": "model",
      "model": {
        "id": "my-model",
        "provider": "my-provider",
        "connection": {
          "kind": "provider-connection"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ModelTool.load(data)
    assert instance is not None
    assert instance.kind == "model"

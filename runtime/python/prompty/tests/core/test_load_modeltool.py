import json

import yaml

from prompty.core import ModelTool


def test_create_modeltool():
    instance = ModelTool()
    assert instance is not None


def test_load_json_modeltool():
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


def test_load_yaml_modeltool():
    yaml_data = """
    kind: model
    model:
      id: my-model
      provider: my-provider
      connection:
        kind: provider-connection
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ModelTool.load(data)
    assert instance is not None
    assert instance.kind == "model"

import json

import yaml

from prompty.core import ServerTool


def test_load_json_servertool():
    json_data = """
    {
      "connection": {
        "kind": "provider-connection"
      },
      "options": {
        "timeout": 30,
        "retries": 3
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ServerTool.load(data)
    assert instance is not None


def test_load_yaml_servertool():
    yaml_data = """
    connection:
      kind: provider-connection
    options:
      timeout: 30
      retries: 3
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ServerTool.load(data)
    assert instance is not None

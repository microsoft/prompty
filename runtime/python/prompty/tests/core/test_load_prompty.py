import json

import yaml

from prompty.core import Prompty


def test_load_json_prompty():
    json_data = """
    {
      "kind": "prompt",
      "model": {
        "id": "gpt-35-turbo",
        "connection": {
          "kind": "key",
          "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
          "key": "{your-api-key}"
        }
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.kind == "prompt"


def test_load_yaml_prompty():
    yaml_data = """
    kind: prompt
    model:
      id: gpt-35-turbo
      connection:
        kind: key
        endpoint: https://{your-custom-endpoint}.openai.azure.com/
        key: "{your-api-key}"
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Prompty.load(data)
    assert instance is not None
    assert instance.kind == "prompt"

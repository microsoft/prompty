import json

import yaml

from prompty.core import PromptyManifest


def test_load_json_promptymanifest():
    json_data = """
    {
      "kind": "manifest",
      "models": [
        {
          "id": "gpt-35-turbo"
        },
        {
          "id": "gpt-4o"
        },
        "custom-model-id"
      ],
      "parameters": {
        "temperature": 0.7,
        "maxTokens": 1000
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = PromptyManifest.load(data)
    assert instance is not None
    assert instance.kind == "manifest"


def test_load_yaml_promptymanifest():
    yaml_data = """
    kind: manifest
    models:
      - id: gpt-35-turbo
      - id: gpt-4o
      - custom-model-id
    parameters:
      temperature: 0.7
      maxTokens: 1000
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = PromptyManifest.load(data)
    assert instance is not None
    assert instance.kind == "manifest"

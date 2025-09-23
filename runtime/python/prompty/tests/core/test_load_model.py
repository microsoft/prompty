import json

import yaml

from prompty.core import Model


def test_create_model():
    instance = Model()
    assert instance is not None


def test_load_json_model():
    json_data = """
    {
      "id": "gpt-35-turbo",
      "provider": "azure",
      "connection": {
        "kind": "key",
        "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
        "key": "{your-api-key}"
      },
      "options": {
        "type": "chat",
        "temperature": 0.7,
        "maxTokens": 1000
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Model.load(data)
    assert instance is not None
    assert instance.id == "gpt-35-turbo"
    assert instance.provider == "azure"


def test_load_yaml_model():
    yaml_data = """
    id: gpt-35-turbo
    provider: azure
    connection:
      kind: key
      endpoint: https://{your-custom-endpoint}.openai.azure.com/
      key: "{your-api-key}"
    options:
      type: chat
      temperature: 0.7
      maxTokens: 1000
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Model.load(data)
    assert instance is not None
    assert instance.id == "gpt-35-turbo"
    assert instance.provider == "azure"


def test_load_model_from_string():
    instance = Model.load("example")
    assert instance is not None
    assert instance.id == "example"

import json

import yaml

from prompty.core import KeyConnection


def test_create_keyconnection():
    instance = KeyConnection()
    assert instance is not None


def test_load_json_keyconnection():
    json_data = """
    {
      "kind": "key",
      "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
      "key": "your-api-key"
    }
    """
    data = json.loads(json_data, strict=False)
    instance = KeyConnection.load(data)
    assert instance is not None
    assert instance.kind == "key"
    assert instance.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"
    assert instance.key == "your-api-key"


def test_load_yaml_keyconnection():
    yaml_data = """
    kind: key
    endpoint: https://{your-custom-endpoint}.openai.azure.com/
    key: your-api-key
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = KeyConnection.load(data)
    assert instance is not None
    assert instance.kind == "key"
    assert instance.endpoint == "https://{your-custom-endpoint}.openai.azure.com/"
    assert instance.key == "your-api-key"

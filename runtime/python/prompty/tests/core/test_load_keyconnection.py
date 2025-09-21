import json

from prompty.core import KeyConnection


def test_create_keyconnection():
    instance = KeyConnection()
    assert instance is not None


def test_load_keyconnection():
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

import json

import yaml

from prompty.model import Model


def test_load_json_model():
    json_data = r"""
    {
      "id": "gpt-35-turbo",
      "provider": "foundry",
      "apiType": "chat",
      "connection": {
        "kind": "key",
        "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
        "key": "{your-api-key}"
      },
      "options": {
        "type": "chat",
        "temperature": 0.7,
        "maxOutputTokens": 1000
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Model.load(data)
    assert instance is not None
    assert instance.id == "gpt-35-turbo"
    assert instance.provider == "foundry"
    assert instance.apiType == "chat"


def test_load_yaml_model():
    yaml_data = r"""
    id: gpt-35-turbo
    provider: foundry
    apiType: chat
    connection:
      kind: key
      endpoint: "https://{your-custom-endpoint}.openai.azure.com/"
      key: "{your-api-key}"
    options:
      type: chat
      temperature: 0.7
      maxOutputTokens: 1000
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = Model.load(data)
    assert instance is not None
    assert instance.id == "gpt-35-turbo"
    assert instance.provider == "foundry"
    assert instance.apiType == "chat"


def test_roundtrip_json_model():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "id": "gpt-35-turbo",
      "provider": "foundry",
      "apiType": "chat",
      "connection": {
        "kind": "key",
        "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
        "key": "{your-api-key}"
      },
      "options": {
        "type": "chat",
        "temperature": 0.7,
        "maxOutputTokens": 1000
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = Model.load(original_data)
    saved_data = instance.save()
    reloaded = Model.load(saved_data)
    assert reloaded is not None
    assert reloaded.id == "gpt-35-turbo"
    assert reloaded.provider == "foundry"
    assert reloaded.apiType == "chat"


def test_to_json_model():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "id": "gpt-35-turbo",
      "provider": "foundry",
      "apiType": "chat",
      "connection": {
        "kind": "key",
        "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
        "key": "{your-api-key}"
      },
      "options": {
        "type": "chat",
        "temperature": 0.7,
        "maxOutputTokens": 1000
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Model.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_model():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "id": "gpt-35-turbo",
      "provider": "foundry",
      "apiType": "chat",
      "connection": {
        "kind": "key",
        "endpoint": "https://{your-custom-endpoint}.openai.azure.com/",
        "key": "{your-api-key}"
      },
      "options": {
        "type": "chat",
        "temperature": 0.7,
        "maxOutputTokens": 1000
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = Model.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


def test_load_model_from_str():
    instance = Model.load("example")
    assert instance is not None
    assert instance.id == "example"
